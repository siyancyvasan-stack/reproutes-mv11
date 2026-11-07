import { Role } from '../../lib/enums.js';
import { randomUUID } from 'node:crypto';
import { isUserPresent } from './presence.service.js';
import { z } from 'zod';
import db from '../../lib/db.js';
import { calculateTrackingMetrics, distanceMeters } from './tracking.metrics.js';
import { hasConfirmedMovement, hasExceededIdleThreshold, isWithinGeofence } from './tracking.idle.js';
import { syncStationarySafetyAlert, systemResolveSafetyAlerts } from '../safety/safety.service.js';

export const telemetrySchema = z.object({
    agentId: z.string().min(1).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().positive().max(500),
    heading: z.number().min(0).max(360).optional(),
    speedKmH: z.number().nonnegative().max(300).optional(),
    altitude: z.number().min(-500).max(10_000).optional(),
    battery: z.number().int().min(0).max(100).optional(),
    deviceTimestamp: z.string().datetime().optional(),
    timestamp: z.string().datetime().optional(),
    capturedAt: z.string().datetime().optional(),
    clientPointId: z.string().min(8).max(100).optional(),
});

const notifyIdle = async (io, alertId, actor) => {
    const [alerts] = await db.query(
        'SELECT i.*, u.name as agentName FROM IdleAlert i JOIN User u ON i.agentId = u.id WHERE i.id = ?',
        [alertId]
    );
    const alert = alerts[0];
    if (!alert) throw new Error('IdleAlert not found');
    
    alert.agent = { name: alert.agentName };

    const stoppedMinutes = Math.max(60, Math.floor((Date.now() - new Date(alert.idleStartedAt).getTime()) / 60_000));
    const [managers] = await db.query(
        'SELECT id FROM User WHERE tenantId = ? AND role IN (?, ?) AND status = ?',
        [actor.tenantId, Role.ADMIN, Role.MANAGER, 'ACTIVE']
    );

    const message = `${alert.agent.name} has remained near ${alert.latitude.toFixed(6)}, ${alert.longitude.toFixed(6)} for ${stoppedMinutes} minutes. Last movement ${new Date(alert.lastMovementAt).toISOString()}. Battery ${alert.battery ?? 'unknown'}%. Last GPS ${new Date(alert.lastGpsAt).toISOString()}.`;

    if (managers.length > 0) {
        const values = managers.map(m => [randomUUID(), actor.tenantId, m.id, 'IDLE_ONE_HOUR', `Idle for 1+ Hour: ${alert.agent.name}`, message]);
        await db.query(
            'INSERT INTO Notification (id, tenantId, userId, type, title, message) VALUES ?',
            [values]
        );
    }

    const payload = {
        id: alert.id,
        agentId: actor.sub,
        agentName: alert.agent.name,
        latitude: alert.latitude,
        longitude: alert.longitude,
        stoppedDurationMinutes: stoppedMinutes,
        lastMovementAt: new Date(alert.lastMovementAt).toISOString(),
        battery: alert.battery,
        lastGpsAt: new Date(alert.lastGpsAt).toISOString(),
        idleStartedAt: new Date(alert.idleStartedAt).toISOString(),
        status: alert.status,
    };
    
    io?.to(`tenant:${actor.tenantId}`).emit('tracking:idle-alert', payload);
    io?.to(`tenant:${actor.tenantId}`).emit('notification:created', { type: 'IDLE_ONE_HOUR' });
    
    return payload;
};

const updateIdleState = async (io, actor, attendanceId, point, profile) => {
    if (profile.status === 'ON_BREAK' || point.accuracy > 100)
        return undefined;
        
    const [settingsRows] = await db.query('SELECT geofenceRadiusMeters FROM TenantSettings WHERE tenantId = ?', [actor.tenantId]);
    const radius = settingsRows[0]?.geofenceRadiusMeters ?? 100;
    
    const idleSince = profile.idleSince ?? point.capturedAt;
    const anchor = profile.idleAnchorLat == null || profile.idleAnchorLng == null
        ? point
        : { latitude: profile.idleAnchorLat, longitude: profile.idleAnchorLng };
        
    const moved = hasConfirmedMovement(anchor, point, radius);
    if (moved) {
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            await connection.query(
                'UPDATE AgentProfile SET idleSince = ?, idleAnchorLat = ?, idleAnchorLng = ?, lastMovementAt = ? WHERE userId = ?',
                [point.capturedAt, point.latitude, point.longitude, point.capturedAt, actor.sub]
            );
            await connection.query(
                'UPDATE IdleAlert SET status = ?, resolvedAt = NOW() WHERE agentId = ? AND status = ?',
                ['RESOLVED', actor.sub, 'OPEN']
            );
            await connection.commit();
        } catch (e) {
            await connection.rollback();
        } finally {
            connection.release();
        }
        await systemResolveSafetyAlerts(actor.tenantId, actor.sub, ['STATIONARY'], 'Automatically resolved after confirmed movement', io);
        return undefined;
    }
    
    await db.query(
        'UPDATE AgentProfile SET idleSince = ?, idleAnchorLat = ?, idleAnchorLng = ?, lastMovementAt = ? WHERE userId = ?',
        [idleSince, anchor.latitude, anchor.longitude, profile.lastMovementAt ?? idleSince, actor.sub]
    );
    
    if (!hasExceededIdleThreshold(idleSince, point.capturedAt))
        return undefined;
        
    const [assignedShops] = await db.query(
        'SELECT id, latitude, longitude FROM Shop WHERE tenantId = ? AND assignedSalespersonId = ? AND active = ? AND latitude IS NOT NULL AND longitude IS NOT NULL',
        [actor.tenantId, actor.sub, true]
    );
    
    const assignedShop = assignedShops.find((shop) => shop.latitude != null && shop.longitude != null &&
        isWithinGeofence(point, { latitude: shop.latitude, longitude: shop.longitude }, radius));
        
    if (assignedShop)
        return undefined;
        
    const episodeKey = `${attendanceId}:${new Date(idleSince).toISOString()}`;
    
    const [existingAlerts] = await db.query('SELECT id FROM IdleAlert WHERE episodeKey = ?', [episodeKey]);
    let alertId;
    if (existingAlerts.length > 0) {
        alertId = existingAlerts[0].id;
        await db.query(
            'UPDATE IdleAlert SET latitude = ?, longitude = ?, lastGpsAt = ?, battery = ? WHERE episodeKey = ?',
            [point.latitude, point.longitude, point.capturedAt, point.battery, episodeKey]
        );
    } else {
        alertId = randomUUID();
        await db.query(
            'INSERT INTO IdleAlert (id, tenantId, agentId, attendanceId, episodeKey, latitude, longitude, idleStartedAt, lastMovementAt, lastGpsAt, battery) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [alertId, actor.tenantId, actor.sub, attendanceId, episodeKey, point.latitude, point.longitude, idleSince, profile.lastMovementAt ?? idleSince, point.capturedAt, point.battery]
        );
    }
    
    const [updateResult] = await db.query('UPDATE IdleAlert SET notifiedAt = NOW() WHERE id = ? AND notifiedAt IS NULL', [alertId]);
    if (updateResult.affectedRows > 0)
        await notifyIdle(io, alertId, actor);
        
    await syncStationarySafetyAlert({
        tenantId: actor.tenantId, agentId: actor.sub, latitude: point.latitude, longitude: point.longitude,
        battery: point.battery, alertStartedAt: idleSince, lastGpsAt: point.capturedAt,
    }, io);
    
    const [alertData] = await db.query('SELECT * FROM IdleAlert WHERE id = ?', [alertId]);
    return alertData[0];
};

export const sweepIdleAlerts = async (io) => {
    const threshold = new Date(Date.now() - 60 * 60_000);
    const freshSince = new Date(Date.now() - 2 * 60_000);
    
    const [attendances] = await db.query(
        'SELECT a.*, p.status as p_status, p.idleSince as p_idleSince, p.lastLocationAt as p_lastLocationAt, p.latitude as p_lat, p.longitude as p_lng, p.batteryLevel as p_battery, p.lastMovementAt as p_lastMovementAt, p.idleAnchorLat as p_idleAnchorLat, p.idleAnchorLng as p_idleAnchorLng, (SELECT COUNT(*) FROM AttendanceBreak WHERE attendanceId = a.id AND endedAt IS NULL) as activeBreaks FROM Attendance a JOIN AgentProfile p ON a.agentId = p.userId WHERE a.checkOutAt IS NULL AND p.status = ? AND p.idleSince <= ? AND p.lastLocationAt >= ?',
        ['ACTIVE', threshold, freshSince]
    );
    
    for (const attendance of attendances) {
        if (attendance.activeBreaks > 0 || attendance.p_lat == null || attendance.p_lng == null || !attendance.p_lastLocationAt)
            continue;
            
        const profile = { status: attendance.p_status, idleSince: attendance.p_idleSince, lastLocationAt: attendance.p_lastLocationAt, latitude: attendance.p_lat, longitude: attendance.p_lng, batteryLevel: attendance.p_battery, lastMovementAt: attendance.p_lastMovementAt, idleAnchorLat: attendance.p_idleAnchorLat, idleAnchorLng: attendance.p_idleAnchorLng };
        
        await updateIdleState(io, { sub: attendance.agentId, tenantId: attendance.tenantId, role: Role.AGENT }, attendance.id, {
            latitude: profile.latitude, longitude: profile.longitude, accuracy: 1,
            battery: profile.batteryLevel ?? undefined, capturedAt: profile.lastLocationAt,
        }, profile);
    }
};

export const pruneExpiredLocationHistory = (retentionDays) => db.query(
    'DELETE FROM LocationPing WHERE recordedAt < ?',
    [new Date(Date.now() - retentionDays * 86_400_000)]
);

export const persistTelemetryPoint = async (actor, payload, io) => {
    if (actor.role !== Role.AGENT)
        return { ok: false, error: 'FORBIDDEN' };
        
    const parsed = telemetrySchema.safeParse(payload);
    const suppliedId = payload && typeof payload === 'object' && 'clientPointId' in payload ? String(payload.clientPointId ?? '') : '';
    if (!parsed.success)
        return { ok: false, error: 'VALIDATION_ERROR', clientPointId: suppliedId || undefined, details: parsed.error.issues };
        
    const clientPointId = parsed.data.clientPointId ?? randomUUID();
    if (parsed.data.agentId && parsed.data.agentId !== actor.sub)
        return { ok: false, error: 'AGENT_ID_MISMATCH', clientPointId };
        
    const receivedAt = new Date();
    const timestamp = parsed.data.capturedAt ?? parsed.data.deviceTimestamp ?? parsed.data.timestamp;
    const capturedAt = timestamp ? new Date(timestamp) : receivedAt;
    
    if (capturedAt.getTime() > receivedAt.getTime() + 5 * 60_000)
        return { ok: false, error: 'INVALID_CAPTURE_TIME', clientPointId };
        
    const [attendances] = await db.query(
        'SELECT * FROM Attendance WHERE agentId = ? AND checkInAt <= ? AND (checkOutAt IS NULL OR checkOutAt >= ?) ORDER BY checkInAt DESC LIMIT 1',
        [actor.sub, capturedAt, capturedAt]
    );
    const attendance = attendances[0];
    
    if (!attendance || capturedAt < new Date(attendance.checkInAt))
        return { ok: false, error: 'SHIFT_NOT_ACTIVE', clientPointId };
        
    const [existing] = await db.query(
        'SELECT recordedAt FROM LocationPing WHERE agentId = ? AND clientPointId = ? LIMIT 1',
        [actor.sub, clientPointId]
    );
    if (existing.length > 0)
        return { ok: true, duplicate: true, clientPointId, serverReceivedAt: new Date(existing[0].recordedAt).toISOString() };
        
    const [previousRows] = await db.query(
        'SELECT * FROM LocationPing WHERE attendanceId = ? AND deviceRecordedAt <= ? ORDER BY deviceRecordedAt DESC LIMIT 1',
        [attendance.id, capturedAt]
    );
    const previous = previousRows[0];
    
    const [profiles] = await db.query('SELECT * FROM AgentProfile WHERE userId = ?', [actor.sub]);
    const profile = profiles[0];
    if (!profile) throw new Error('AgentProfile not found');
    
    const segment = previous ? distanceMeters(previous, parsed.data) : 0;
    const poorAccuracy = (parsed.data.accuracy ?? 0) > 50;
    const duplicateMovement = Boolean(previous && segment < 10);
    const implausibleSpeed = (parsed.data.speedKmH ?? 0) > 180;
    const retainedForDistance = !poorAccuracy && !duplicateMovement && !implausibleSpeed;
    
    const pingId = randomUUID();
    await db.query(
        'INSERT INTO LocationPing (id, tenantId, agentId, attendanceId, clientPointId, latitude, longitude, accuracy, heading, speedKmH, altitude, battery, shiftStatus, segmentDistanceMeters, retainedForDistance, distanceExclusionReason, deviceRecordedAt, recordedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [pingId, actor.tenantId, actor.sub, attendance.id, clientPointId, parsed.data.latitude, parsed.data.longitude, parsed.data.accuracy, parsed.data.heading, parsed.data.speedKmH, parsed.data.altitude, parsed.data.battery, profile.status === 'ON_BREAK' ? 'ON_BREAK' : 'WORKING', retainedForDistance ? segment : 0, retainedForDistance, poorAccuracy ? 'POOR_ACCURACY' : implausibleSpeed ? 'IMPLAUSIBLE_SPEED' : duplicateMovement ? 'DUPLICATE_OR_NOISE' : null, capturedAt, receivedAt]
    );
    
    const isNewest = !profile.lastLocationAt || capturedAt >= new Date(profile.lastLocationAt);
    
    const [points] = await db.query('SELECT * FROM LocationPing WHERE attendanceId = ? ORDER BY deviceRecordedAt ASC', [attendance.id]);
    
    const metrics = calculateTrackingMetrics(points, new Date(attendance.checkInAt), attendance.checkOutAt ? new Date(attendance.checkOutAt) : receivedAt, 30);
    
    let updatedProfileStatus = profile.status;
    let updatedLastHeartbeatAt = profile.lastHeartbeatAt;
    let updatedLastMovementAt = profile.lastMovementAt;

    if (isNewest) {
        await db.query(
            'UPDATE AgentProfile SET batteryLevel = ?, lastSpeedKmH = ?, lastLocationAt = ?, locationPermission = ?, trackingState = ?, trackingStateAt = ?, latitude = ?, longitude = ? WHERE userId = ?',
            [parsed.data.battery, parsed.data.speedKmH, capturedAt, 'granted', 'ACTIVE', receivedAt, parsed.data.latitude, parsed.data.longitude, actor.sub]
        );
    } else {
        await db.query(
            'UPDATE AgentProfile SET batteryLevel = ?, lastSpeedKmH = ?, locationPermission = ?, trackingState = ?, trackingStateAt = ? WHERE userId = ?',
            [parsed.data.battery, parsed.data.speedKmH, 'granted', 'ACTIVE', receivedAt, actor.sub]
        );
    }
    
    await systemResolveSafetyAlerts(actor.tenantId, actor.sub, [
        'OFFLINE', 'INTERNET_DISCONNECTED', 'GPS_DISABLED', 'LOCATION_PERMISSION_DENIED', 'BACKGROUND_TRACKING_STOPPED',
        ...(parsed.data.battery != null && parsed.data.battery > 20 ? ['LOW_BATTERY'] : []),
    ], 'Automatically resolved after a fresh GPS location was received', io);
    
    await db.query(
        'UPDATE Attendance SET distanceKm = ?, workDistanceKm = ?, breakDistanceKm = ?, averageSpeedKmH = ?, maximumSpeedKmH = ?, totalStops = ?, totalIdleMinutes = ?, gpsCoverage = ?, gpsDelayCount = ?, longestGpsGapSec = ? WHERE id = ?',
        [metrics.totalDistanceKm, metrics.workDistanceKm, metrics.breakDistanceKm, metrics.averageSpeedKmH, metrics.maximumSpeedKmH, metrics.totalStops, metrics.totalIdleMinutes, metrics.gpsCoverage, metrics.gpsDelayCount, metrics.longestGpsGapSeconds, attendance.id]
    );
    
    let idleAlert = undefined;
    if (!attendance.checkOutAt) {
        const [updatedProfiles] = await db.query('SELECT * FROM AgentProfile WHERE userId = ?', [actor.sub]);
        const currentProfile = updatedProfiles[0];
        updatedProfileStatus = currentProfile.status;
        updatedLastHeartbeatAt = currentProfile.lastHeartbeatAt;
        updatedLastMovementAt = currentProfile.lastMovementAt;
        idleAlert = await updateIdleState(io, actor, attendance.id, { ...parsed.data, capturedAt }, currentProfile);
    }

    const message = {
        agentId: actor.sub, latitude: parsed.data.latitude, longitude: parsed.data.longitude, accuracy: parsed.data.accuracy,
        heading: parsed.data.heading, speedKmH: parsed.data.speedKmH, altitude: parsed.data.altitude, battery: parsed.data.battery,
        deviceTimestamp: capturedAt.toISOString(), serverReceivedAt: receivedAt.toISOString(),
        status: attendance.checkOutAt ? 'Offline' : updatedProfileStatus === 'ON_BREAK' ? 'On Break' : 'Active', shiftActive: !attendance.checkOutAt,
        socketConnected: await isUserPresent(actor.tenantId, actor.sub), lastHeartbeatAt: updatedLastHeartbeatAt ? new Date(updatedLastHeartbeatAt).toISOString() : undefined,
        lastLocationAt: capturedAt.toISOString(), locationPermission: 'granted', trackingState: 'ACTIVE',
        lastUpdatedAt: capturedAt.toISOString(), distanceKm: metrics.totalDistanceKm,
        workDistanceKm: metrics.workDistanceKm, breakDistanceKm: metrics.breakDistanceKm,
        idleStatus: idleAlert?.status === 'OPEN' ? 'IDLE_1H' : 'MOVING',
        idleSince: idleAlert?.idleStartedAt ? new Date(idleAlert.idleStartedAt).toISOString() : undefined, lastMovementAt: updatedLastMovementAt ? new Date(updatedLastMovementAt).toISOString() : undefined,
    };
    
    io?.to(`tenant:${actor.tenantId}`).emit('tracking:agent-location', message);
    return { ok: true, clientPointId, capturedAt: capturedAt.toISOString(), serverReceivedAt: receivedAt.toISOString() };
};
