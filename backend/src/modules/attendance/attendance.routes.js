import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { calculateTrackingMetrics } from '../tracking/tracking.metrics.js';
import { recordAgentActivity } from '../agents/agent-activity.service.js';
import { ATTENDANCE_GPS_MAX_ACCURACY_METERS } from './attendance.policy.js';
import { randomUUID } from 'node:crypto';
import { verifyPassword } from '../../lib/password.js';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const gpsFields = {
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    accuracy: z.number().nonnegative().optional().nullable(),
    speedKmH: z.number().nonnegative().max(300).optional().nullable(),
    heading: z.number().min(0).max(360).optional().nullable(),
    altitude: z.number().min(-500).max(10_000).optional().nullable(),
    deviceTimestamp: z.string().datetime().optional().nullable(),
    locationPermission: z.enum(['granted', 'denied', 'prompt', 'unavailable', 'unknown']).optional().default('unknown'),
};
const gps = z.object(gpsFields);
const checkoutGps = z.object({
    ...gpsFields,
});

attendanceRouter.get('/status', authorize(Role.AGENT), async (req, res) => {
    const [[attendances], [profiles]] = await Promise.all([
        db.query('SELECT * FROM Attendance WHERE agentId = ? AND checkOutAt IS NULL ORDER BY checkInAt DESC LIMIT 1', [req.auth.sub]),
        db.query('SELECT status FROM AgentProfile WHERE userId = ?', [req.auth.sub])
    ]);
    const openAttendance = attendances[0];
    const profile = profiles[0];
    
    if (openAttendance) {
        const [breaks] = await db.query('SELECT * FROM AttendanceBreak WHERE attendanceId = ? ORDER BY startedAt ASC', [openAttendance.id]);
        openAttendance.breaks = breaks;
    }
    
    res.json({ checkedIn: Boolean(openAttendance), shiftStatus: profile?.status ?? 'OFFLINE', attendance: openAttendance });
});

attendanceRouter.get('/', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const date = req.query.date ? new Date(String(req.query.date)) : undefined;
    let query = 'SELECT a.*, u.id as agent_id, u.name as agent_name, u.employeeCode as agent_employeeCode FROM Attendance a JOIN User u ON a.agentId = u.id WHERE a.tenantId = ?';
    const params = [req.auth.tenantId];
    if (date) {
        query += ' AND a.date = ?';
        params.push(date);
    }
    query += ' ORDER BY a.checkInAt DESC';
    
    const [rows] = await db.query(query, params);
    const result = rows.map(r => ({
        ...r,
        agent: { id: r.agent_id, name: r.agent_name, employeeCode: r.agent_employeeCode },
        agent_id: undefined, agent_name: undefined, agent_employeeCode: undefined
    }));
    res.json(result);
});

attendanceRouter.delete("/:id", authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const [records] = await db.query('SELECT id, agentId, checkOutAt FROM Attendance WHERE id = ? AND tenantId = ? LIMIT 1', [String(req.params.id), req.auth.tenantId]);
    const record = records[0];
    if (!record)
        return res.status(404).json({ error: { code: "ATTENDANCE_NOT_FOUND", message: "Attendance record not found." } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('DELETE FROM Attendance WHERE id = ?', [record.id]);
        if (!record.checkOutAt) {
            await connection.query(
                'UPDATE AgentProfile SET status = ?, shiftActive = ?, trackingState = ?, trackingStateAt = ? WHERE userId = ?',
                ['OFFLINE', false, 'STOPPED', new Date(), record.agentId]
            );
        }
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const updatedAt = new Date().toISOString();
    req.app.get("io")?.to(`tenant:${req.auth.tenantId}`).emit("attendance:updated", { attendanceId: record.id, agentId: record.agentId, action: "delete", updatedAt });
    logger.info({ event: "attendance-delete", attendanceId: record.id, agentId: record.agentId, actorId: req.auth.sub }, "Attendance record deleted");
    res.status(204).send();
});

attendanceRouter.get("/report", authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const tenantId = req.auth.tenantId;
    const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() + 1);
    
    const [agents] = await db.query(
        'SELECT id, name, employeeCode, avatarUrl FROM User WHERE tenantId = ? AND role = ? AND status = ? ORDER BY name ASC',
        [tenantId, Role.AGENT, 'ACTIVE']
    );
    
    const [rawRecords] = await db.query(
        'SELECT a.*, u.id as u_id, u.name as u_name, u.employeeCode as u_employeeCode, u.avatarUrl as u_avatarUrl FROM Attendance a JOIN User u ON a.agentId = u.id WHERE a.tenantId = ? AND a.date >= ? AND a.date < ? ORDER BY a.date ASC, a.checkInAt ASC',
        [tenantId, from, to]
    );
    
    let breaks = [];
    let locations = [];
    if (rawRecords.length > 0) {
        const attendanceIds = rawRecords.map(r => r.id);
        const placeholders = attendanceIds.map(() => '?').join(',');
        
        [breaks] = await db.query(`SELECT * FROM AttendanceBreak WHERE attendanceId IN (${placeholders}) ORDER BY startedAt ASC`, attendanceIds);
        [locations] = await db.query(`SELECT * FROM LocationPing WHERE attendanceId IN (${placeholders}) ORDER BY deviceRecordedAt ASC`, attendanceIds);
    }
    
    const breaksByAttendance = new Map();
    breaks.forEach(b => {
        if (!breaksByAttendance.has(b.attendanceId)) breaksByAttendance.set(b.attendanceId, []);
        breaksByAttendance.get(b.attendanceId).push(b);
    });
    
    const locationsByAttendance = new Map();
    locations.forEach(l => {
        if (!locationsByAttendance.has(l.attendanceId)) locationsByAttendance.set(l.attendanceId, []);
        locationsByAttendance.get(l.attendanceId).push(l);
    });

    const records = rawRecords.map(r => {
        const recordBreaks = breaksByAttendance.get(r.id) ?? [];
        const recordLocations = locationsByAttendance.get(r.id) ?? [];
        
        const shiftEnd = r.checkOutAt ? new Date(r.checkOutAt) : now;
        const metrics = calculateTrackingMetrics(recordLocations, new Date(r.checkInAt), shiftEnd, 15);
        const breakSeconds = recordBreaks.reduce((sum, item) => sum + Math.max(0, ((item.endedAt ? new Date(item.endedAt) : now).getTime() - new Date(item.startedAt).getTime()) / 1000), 0);
        const shiftSeconds = Math.max(0, (shiftEnd.getTime() - new Date(r.checkInAt).getTime()) / 1000);
        
        const record = { ...r };
        delete record.u_id; delete record.u_name; delete record.u_employeeCode; delete record.u_avatarUrl;
        record.agent = { id: r.u_id, name: r.u_name, employeeCode: r.u_employeeCode, avatarUrl: r.u_avatarUrl };
        
        return {
            ...record,
            ...metrics,
            shiftDurationMinutes: Math.round(shiftSeconds / 60),
            breakDurationMinutes: Math.round(breakSeconds / 60),
            workingDurationMinutes: Math.round(Math.max(0, shiftSeconds - breakSeconds) / 60),
            breaks: recordBreaks,
            routeHistory: recordLocations.map((point) => ({
                latitude: point.latitude,
                longitude: point.longitude,
                accuracy: point.accuracy,
                speedKmH: point.speedKmH,
                heading: point.heading,
                capturedAt: (point.deviceRecordedAt ?? point.recordedAt).toISOString(),
                receivedAt: point.recordedAt.toISOString(),
                shiftStatus: point.shiftStatus,
            })),
        };
    });
    
    const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
    const todayKey = dateKey(today);
    const todayRecords = records.filter((record) => dateKey(record.date) === todayKey);
    const statusCount = (status) => todayRecords.filter((record) => String(record.status) === status).length;
    
    const onLeave = statusCount('ON_LEAVE');
    const present = todayRecords.filter((record) => String(record.status) !== 'ON_LEAVE').length;
    const late = statusCount('LATE');
    const absent = Math.max(agents.length - present - onLeave, 0);
    const attendancePercentage = agents.length ? Number(((present / agents.length) * 100).toFixed(1)) : 0;
    
    const daily = Array.from({ length: days }, (_, index) => {
        const date = new Date(from);
        date.setUTCDate(from.getUTCDate() + index);
        const key = dateKey(date);
        const rows = records.filter((record) => dateKey(record.date) === key);
        const leaveCount = rows.filter((record) => String(record.status) === 'ON_LEAVE').length;
        const attendedCount = rows.filter((record) => String(record.status) !== 'ON_LEAVE').length;
        return {
            date: key,
            day: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
            present: attendedCount,
            late: rows.filter((record) => record.status === 'LATE').length,
            onLeave: leaveCount,
            absent: Math.max(agents.length - attendedCount - leaveCount, 0),
            attendancePercentage: agents.length
                ? Number(((attendedCount / agents.length) * 100).toFixed(1))
                : 0,
        };
    });
    
    const leaderboard = agents
        .map((agent) => {
        const agentRecords = records.filter((record) => record.agentId === agent.id);
        const leaveDays = agentRecords.filter((record) => String(record.status) === 'ON_LEAVE').length;
        const attendedRecords = agentRecords.filter((record) => String(record.status) !== 'ON_LEAVE');
        const lateDays = attendedRecords.filter((record) => record.status === 'LATE').length;
        return {
            agentId: agent.id,
            name: agent.name,
            employeeCode: agent.employeeCode,
            avatarUrl: agent.avatarUrl,
            presentDays: attendedRecords.length,
            lateDays,
            leaveDays,
            totalDistanceKm: Number(attendedRecords.reduce((sum, record) => sum + record.distanceKm, 0).toFixed(1)),
            attendancePercentage: Number(((attendedRecords.length / days) * 100).toFixed(1)),
        };
    })
        .sort((a, b) => b.presentDays - a.presentDays ||
        a.lateDays - b.lateDays ||
        b.totalDistanceKm - a.totalDistanceKm ||
        a.name.localeCompare(b.name))
        .slice(0, 5);
        
    res.json({
        generatedAt: now.toISOString(),
        range: { from: dateKey(from), to: todayKey, days },
        today: { date: todayKey, totalAgents: agents.length, present, absent, late, onLeave, attendancePercentage },
        daily,
        leaderboard,
        records,
    });
});

attendanceRouter.post('/check-in', authorize(Role.AGENT), async (req, res) => {
    const input = gps.parse(req.body);
    const [existingRecords] = await db.query(
        'SELECT * FROM Attendance WHERE agentId = ? AND checkOutAt IS NULL ORDER BY checkInAt DESC LIMIT 1',
        [req.auth.sub]
    );
    if (existingRecords.length > 0)
        return res.json(existingRecords[0]);
        
    const now = new Date();
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let record;
    try {
        await connection.query(
            'UPDATE AgentProfile SET status = ?, shiftActive = ?, lastLocationAt = ?, locationPermission = ?, latitude = ?, longitude = ?, trackingState = ?, trackingStateAt = ?, lastMovementAt = ?, idleSince = ?, idleAnchorLat = ?, idleAnchorLng = ? WHERE userId = ?',
            ['ACTIVE', true, now, input.locationPermission, input.latitude ?? null, input.longitude ?? null, input.locationPermission === 'granted' ? 'ACTIVE' : 'INTERRUPTED', now, now, now, input.latitude ?? null, input.longitude ?? null, req.auth.sub]
        );
        
        const [upsertCheck] = await connection.query('SELECT id FROM Attendance WHERE agentId = ? AND date = ?', [req.auth.sub, date]);
        
        if (upsertCheck.length > 0) {
            record = upsertCheck[0];
            await connection.query(
                'UPDATE Attendance SET checkInAt = ?, checkInLat = ?, checkInLng = ?, checkInAccuracy = ?, checkOutAt = NULL, checkOutLat = NULL, checkOutLng = NULL, checkOutAccuracy = NULL WHERE id = ?',
                [now, input.latitude ?? null, input.longitude ?? null, input.accuracy ?? null, record.id]
            );
        } else {
            record = { id: randomUUID(), tenantId: req.auth.tenantId, agentId: req.auth.sub, date, checkInAt: now, checkInLat: input.latitude ?? null, checkInLng: input.longitude ?? null, checkInAccuracy: input.accuracy ?? null };
            await connection.query(
                'INSERT INTO Attendance (id, tenantId, agentId, date, checkInAt, checkInLat, checkInLng, checkInAccuracy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [record.id, record.tenantId, record.agentId, record.date, record.checkInAt, record.checkInLat, record.checkInLng, record.checkInAccuracy]
            );
        }
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const [finalRecords] = await db.query('SELECT * FROM Attendance WHERE id = ?', [record.id]);
    const finalRecord = finalRecords[0];
    
    await recordAgentActivity({ tenantId: req.auth.tenantId, agentId: req.auth.sub, eventType: 'PUNCH_IN', occurredAt: finalRecord.checkInAt, latitude: input.latitude ?? null, longitude: input.longitude ?? null, entityType: 'Attendance', entityId: finalRecord.id, sourceKey: `attendance:${finalRecord.id}:in`, metadata: { title: 'Punch In' } });
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('tracking:agent-location', {
        agentId: req.auth.sub,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
        speedKmH: input.speedKmH,
        heading: input.heading,
        altitude: input.altitude,
        deviceTimestamp: input.deviceTimestamp,
        serverReceivedAt: now.toISOString(),
        status: 'Active',
        shiftActive: true,
        lastLocationAt: now.toISOString(),
        locationPermission: input.locationPermission,
        lastUpdatedAt: now.toISOString(),
    });
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('attendance:updated', { attendanceId: finalRecord.id, agentId: req.auth.sub, action: 'check-in', updatedAt: now.toISOString() });
    logger.info({ event: 'check-in', agentId: req.auth.sub, attendanceId: finalRecord.id }, 'Agent checked in and GPS tracking may start');
    res.status(201).json(finalRecord);
});

attendanceRouter.post('/verify-password', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({ password: z.string().min(1) }).parse(req.body);
    const [users] = await db.query('SELECT passwordHash FROM User WHERE id = ? AND status = ? LIMIT 1', [req.auth.sub, 'ACTIVE']);
    const user = users[0];
    if (!user) {
        return res.status(403).json({ error: { code: 'USER_INACTIVE', message: 'Account is not active.' } });
    }
    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
        await db.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'PASSWORD_VERIFY_FAILED', 'User', req.auth.sub, req.ip]
        );
        return res.status(401).json({ error: { code: 'INVALID_PASSWORD', message: 'Password is incorrect.' } });
    }
    await db.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
        [req.auth.tenantId, req.auth.sub, 'PASSWORD_VERIFIED', 'User', req.auth.sub, req.ip]
    );
    res.json({ verified: true });
});

attendanceRouter.post('/break/start', authorize(Role.AGENT), async (req, res) => {
    const [attendances] = await db.query('SELECT * FROM Attendance WHERE agentId = ? AND checkOutAt IS NULL ORDER BY checkInAt DESC LIMIT 1', [req.auth.sub]);
    const attendance = attendances[0];
    if (!attendance)
        return res.status(409).json({ error: { code: 'SHIFT_NOT_ACTIVE', message: 'Start your shift before taking a break.' } });
        
    const [existingBreaks] = await db.query('SELECT * FROM AttendanceBreak WHERE attendanceId = ? AND endedAt IS NULL LIMIT 1', [attendance.id]);
    if (existingBreaks.length > 0)
        return res.json(existingBreaks[0]);
        
    const now = new Date();
    const breakId = randomUUID();
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(
            'INSERT INTO AttendanceBreak (id, tenantId, attendanceId, agentId, startedAt) VALUES (?, ?, ?, ?, ?)',
            [breakId, req.auth.tenantId, attendance.id, req.auth.sub, now]
        );
        await connection.query('UPDATE AgentProfile SET status = ? WHERE userId = ?', ['ON_BREAK', req.auth.sub]);
        await connection.query('UPDATE IdleAlert SET status = ?, resolvedAt = ? WHERE agentId = ? AND status = ?', ['RESOLVED', now, req.auth.sub, 'OPEN']);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const [newBreaks] = await db.query('SELECT * FROM AttendanceBreak WHERE id = ?', [breakId]);
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('tracking:agent-location', {
        agentId: req.auth.sub,
        status: 'On Break',
        shiftActive: true,
    });
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('attendance:updated', {
        attendanceId: attendance.id, agentId: req.auth.sub, action: 'break-start', updatedAt: now.toISOString(),
    });
    return res.status(201).json(newBreaks[0]);
});

attendanceRouter.post('/break/end', authorize(Role.AGENT), async (req, res) => {
    const [attendances] = await db.query('SELECT * FROM Attendance WHERE agentId = ? AND checkOutAt IS NULL ORDER BY checkInAt DESC LIMIT 1', [req.auth.sub]);
    const attendance = attendances[0];
    if (!attendance)
        return res.status(409).json({ error: { code: 'SHIFT_NOT_ACTIVE', message: 'No active shift.' } });
        
    const [openBreaks] = await db.query('SELECT * FROM AttendanceBreak WHERE attendanceId = ? AND endedAt IS NULL LIMIT 1', [attendance.id]);
    const openBreak = openBreaks[0];
    if (!openBreak)
        return res.status(409).json({ error: { code: 'BREAK_NOT_ACTIVE', message: 'No active break.' } });
        
    const now = new Date();
    
    const [distanceRows] = await db.query(
        'SELECT SUM(segmentDistanceMeters) as sumMeters FROM LocationPing WHERE attendanceId = ? AND shiftStatus = ? AND deviceRecordedAt >= ? AND deviceRecordedAt <= ?',
        [attendance.id, 'ON_BREAK', openBreak.startedAt, now]
    );
    const breakDistanceMeters = distanceRows[0].sumMeters ?? 0;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(
            'UPDATE AttendanceBreak SET endedAt = ?, distanceKm = ? WHERE id = ?',
            [now, breakDistanceMeters / 1000, openBreak.id]
        );
        await connection.query('UPDATE AgentProfile SET status = ? WHERE userId = ?', ['ACTIVE', req.auth.sub]);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const [updatedBreaks] = await db.query('SELECT * FROM AttendanceBreak WHERE id = ?', [openBreak.id]);
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('tracking:agent-location', {
        agentId: req.auth.sub,
        status: 'Active',
        shiftActive: true,
    });
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('attendance:updated', {
        attendanceId: attendance.id, agentId: req.auth.sub, action: 'break-end', updatedAt: now.toISOString(),
    });
    return res.json(updatedBreaks[0]);
});

attendanceRouter.post('/check-out', authorize(Role.AGENT), async (req, res) => {
    const input = checkoutGps.parse(req.body);
    const [records] = await db.query('SELECT * FROM Attendance WHERE agentId = ? AND checkOutAt IS NULL ORDER BY checkInAt DESC LIMIT 1', [req.auth.sub]);
    const record = records[0];
    if (!record)
        return res.status(404).json({ error: { code: 'NO_OPEN_ATTENDANCE' } });
        
    const now = new Date();
    await db.query('UPDATE AttendanceBreak SET endedAt = ? WHERE attendanceId = ? AND endedAt IS NULL', [now, record.id]);
    
    const [points] = await db.query('SELECT * FROM LocationPing WHERE attendanceId = ? ORDER BY deviceRecordedAt ASC', [record.id]);
    const metrics = calculateTrackingMetrics(points, new Date(record.checkInAt), now, 15);
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(
            'UPDATE AgentProfile SET status = ?, shiftActive = ?, lastLocationAt = ?, locationPermission = ?, latitude = ?, longitude = ?, trackingState = ?, trackingStateAt = ?, idleSince = NULL, idleAnchorLat = NULL, idleAnchorLng = NULL WHERE userId = ?',
            ['OFFLINE', false, now, input.locationPermission, input.latitude ?? null, input.longitude ?? null, 'UNKNOWN', now, req.auth.sub]
        );
        await connection.query(
            'UPDATE Attendance SET checkOutAt = ?, checkOutLat = ?, checkOutLng = ?, checkOutAccuracy = ?, distanceKm = ?, workDistanceKm = ?, breakDistanceKm = ?, averageSpeedKmH = ?, maximumSpeedKmH = ?, totalStops = ?, totalIdleMinutes = ?, gpsCoverage = ?, gpsDelayCount = ?, longestGpsGapSec = ? WHERE id = ?',
            [now, input.latitude ?? null, input.longitude ?? null, input.accuracy ?? null, metrics.totalDistanceKm, metrics.workDistanceKm, metrics.breakDistanceKm, metrics.averageSpeedKmH, metrics.maximumSpeedKmH, metrics.totalStops, metrics.totalIdleMinutes, metrics.gpsCoverage, metrics.gpsDelayCount, metrics.longestGpsGapSeconds, record.id]
        );
        await connection.query('UPDATE IdleAlert SET status = ?, resolvedAt = ? WHERE agentId = ? AND status = ?', ['RESOLVED', now, req.auth.sub, 'OPEN']);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const [updatedRecords] = await db.query('SELECT * FROM Attendance WHERE id = ?', [record.id]);
    const attendance = updatedRecords[0];
    
    await recordAgentActivity({ tenantId: req.auth.tenantId, agentId: req.auth.sub, eventType: 'PUNCH_OUT', occurredAt: now, latitude: input.latitude ?? null, longitude: input.longitude ?? null, entityType: 'Attendance', entityId: attendance.id, sourceKey: `attendance:${attendance.id}:out`, metadata: { title: 'Punch Out' } });
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('tracking:agent-location', {
        agentId: req.auth.sub,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
        speedKmH: input.speedKmH,
        heading: input.heading,
        altitude: input.altitude,
        deviceTimestamp: input.deviceTimestamp,
        serverReceivedAt: now.toISOString(),
        status: 'Offline',
        shiftActive: false,
        lastLocationAt: now.toISOString(),
        locationPermission: input.locationPermission,
        lastUpdatedAt: now.toISOString(),
    });
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('attendance:updated', { attendanceId: attendance.id, agentId: req.auth.sub, action: 'check-out', updatedAt: now.toISOString() });
    logger.info({ event: 'check-out', agentId: req.auth.sub, attendanceId: attendance.id }, 'Agent checked out and GPS tracking must stop');
    return res.json(attendance);
});
