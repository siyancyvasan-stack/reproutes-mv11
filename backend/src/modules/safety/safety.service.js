import { Role } from '../../lib/enums.js';
import db from '../../lib/db.js';
import { randomUUID } from 'node:crypto';

export const safetyAlertTypes = [
    'OFFLINE', 'STATIONARY', 'GPS_DISABLED', 'LOCATION_PERMISSION_DENIED',
    'LOW_BATTERY', 'INTERNET_DISCONNECTED', 'BACKGROUND_TRACKING_STOPPED',
    'SOS', 'INCIDENT', 'CHECK_IN',
];

export const severityFor = (type) => {
    if (type === 'SOS') return 'CRITICAL';
    if (['OFFLINE', 'GPS_DISABLED', 'LOCATION_PERMISSION_DENIED', 'INTERNET_DISCONNECTED', 'BACKGROUND_TRACKING_STOPPED', 'INCIDENT'].includes(type)) return 'HIGH';
    if (['STATIONARY', 'LOW_BATTERY'].includes(type)) return 'WARNING';
    return 'INFO';
};

export const upsertOpenSafetyAlert = async (input, io) => {
    const severity = severityFor(input.type);
    
    const [existingAlerts] = await db.query(
        'SELECT id FROM SafetyEvent WHERE tenantId = ? AND agentId = ? AND type = ? AND status = ? AND archivedAt IS NULL AND deletedAt IS NULL LIMIT 1',
        [input.tenantId, input.agentId, input.type, 'OPEN']
    );
    const existing = existingAlerts[0];
    
    if (existing) {
        await db.query(
            'UPDATE SafetyEvent SET severity = ?, description = ?, latitude = ?, longitude = ?, accuracy = ?, battery = ?, lastGpsAt = ?, updatedAt = NOW() WHERE id = ?',
            [severity, input.description, input.latitude, input.longitude, input.accuracy, input.battery, input.lastGpsAt, existing.id]
        );
        const [updatedAlerts] = await db.query('SELECT * FROM SafetyEvent WHERE id = ?', [existing.id]);
        return updatedAlerts[0];
    }
    
    try {
        const id = randomUUID();
        const alertStartedAt = input.alertStartedAt ?? new Date();
        await db.query(
            'INSERT INTO SafetyEvent (id, tenantId, agentId, type, severity, description, latitude, longitude, accuracy, battery, alertStartedAt, lastGpsAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, input.tenantId, input.agentId, input.type, severity, input.description, input.latitude, input.longitude, input.accuracy, input.battery, alertStartedAt, input.lastGpsAt]
        );
        const [createdAlerts] = await db.query('SELECT * FROM SafetyEvent WHERE id = ?', [id]);
        const created = createdAlerts[0];
        io?.to(`tenant:${input.tenantId}`).emit('safety:alert', created);
        return created;
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        
        await db.query(
            'UPDATE SafetyEvent SET severity = ?, description = ?, latitude = ?, longitude = ?, accuracy = ?, battery = ?, lastGpsAt = ?, updatedAt = NOW() WHERE tenantId = ? AND agentId = ? AND type = ? AND status = ? AND archivedAt IS NULL AND deletedAt IS NULL',
            [severity, input.description, input.latitude, input.longitude, input.accuracy, input.battery, input.lastGpsAt, input.tenantId, input.agentId, input.type, 'OPEN']
        );
        const [recoveredAlerts] = await db.query(
            'SELECT * FROM SafetyEvent WHERE tenantId = ? AND agentId = ? AND type = ? AND status = ? AND archivedAt IS NULL AND deletedAt IS NULL LIMIT 1',
            [input.tenantId, input.agentId, input.type, 'OPEN']
        );
        return recoveredAlerts[0];
    }
};

export const auditSafetyAction = (tenantId, actorId, action, eventId, reason, ipAddress) => 
    db.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, ipAddress) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [tenantId, actorId, action, 'SafetyEvent', eventId, JSON.stringify({ reason }), ipAddress]
    );

export const systemResolveSafetyAlerts = async (tenantId, agentId, types, note, io) => {
    if (types.length === 0) return 0;
    
    const placeholders = types.map(() => '?').join(',');
    const [events] = await db.query(
        `SELECT id FROM SafetyEvent WHERE tenantId = ? AND agentId = ? AND type IN (${placeholders}) AND status = ? AND deletedAt IS NULL`,
        [tenantId, agentId, ...types, 'OPEN']
    );
    
    if (!events.length) return 0;
    
    const ids = events.map(e => e.id);
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const idPlaceholders = ids.map(() => '?').join(',');
        await connection.query(
            `UPDATE SafetyEvent SET status = ?, resolvedAt = NOW(), resolutionNote = ? WHERE id IN (${idPlaceholders})`,
            ['RESOLVED', note, ...ids]
        );
        
        const auditValues = ids.map(id => [randomUUID(), tenantId, null, 'SAFETY_ALERT_AUTO_RESOLVED', 'SafetyEvent', id, JSON.stringify({ reason: note })]);
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata) VALUES ?',
            [auditValues]
        );
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    io?.to(`tenant:${tenantId}`).emit('safety:resolved', { ids });
    return events.length;
};

export const syncStationarySafetyAlert = (input, io) => upsertOpenSafetyAlert({ ...input, type: 'STATIONARY', description: input.description ?? 'Agent has been stationary for at least 60 minutes' }, io);

export const sweepSafetyAlerts = async (io) => {
    const now = Date.now();
    const [profiles] = await db.query(
        'SELECT p.userId, p.latitude, p.longitude, p.batteryLevel, p.lastLocationAt, p.lastHeartbeatAt, p.locationPermission, p.appState, u.tenantId, u.name FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE p.shiftActive = ? AND u.role = ? AND u.status = ?',
        [true, Role.AGENT, 'ACTIVE']
    );
    
    for (const profile of profiles) {
        const base = { tenantId: profile.tenantId, agentId: profile.userId, latitude: profile.latitude, longitude: profile.longitude, battery: profile.batteryLevel, lastGpsAt: profile.lastLocationAt ? new Date(profile.lastLocationAt) : undefined };
        const heartbeatAge = profile.lastHeartbeatAt ? now - new Date(profile.lastHeartbeatAt).getTime() : Number.POSITIVE_INFINITY;
        const gpsAge = profile.lastLocationAt ? now - new Date(profile.lastLocationAt).getTime() : Number.POSITIVE_INFINITY;
        
        if (gpsAge >= 90_000)
            await upsertOpenSafetyAlert({ ...base, type: 'OFFLINE', alertStartedAt: profile.lastLocationAt ? new Date(profile.lastLocationAt) : undefined, description: 'No fresh GPS location has been received for more than 90 seconds' }, io);
        if (heartbeatAge >= 90_000)
            await upsertOpenSafetyAlert({ ...base, type: 'INTERNET_DISCONNECTED', alertStartedAt: profile.lastHeartbeatAt ? new Date(profile.lastHeartbeatAt) : undefined, description: 'Agent heartbeat has not reached the server for more than 90 seconds' }, io);
        if (profile.locationPermission === 'denied')
            await upsertOpenSafetyAlert({ ...base, type: 'LOCATION_PERMISSION_DENIED', description: 'Location permission is denied on the agent device' }, io);
        if (profile.locationPermission === 'unavailable')
            await upsertOpenSafetyAlert({ ...base, type: 'GPS_DISABLED', description: 'GPS or device location services are unavailable' }, io);
        if (profile.batteryLevel != null && profile.batteryLevel <= 15)
            await upsertOpenSafetyAlert({ ...base, type: 'LOW_BATTERY', description: `Agent device battery is ${profile.batteryLevel}%` }, io);
        if (profile.appState === 'background' && heartbeatAge >= 5 * 60_000)
            await upsertOpenSafetyAlert({ ...base, type: 'BACKGROUND_TRACKING_STOPPED', alertStartedAt: profile.lastHeartbeatAt ? new Date(profile.lastHeartbeatAt) : undefined, description: 'Background tracking has stopped sending heartbeats' }, io);
    }
};
