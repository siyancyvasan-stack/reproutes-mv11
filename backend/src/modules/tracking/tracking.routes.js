import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { z } from 'zod';
import { persistTelemetryPoint } from './tracking.service.js';
import { systemResolveSafetyAlerts, upsertOpenSafetyAlert } from '../safety/safety.service.js';
import { getPresentUsers, isUserPresent } from './presence.service.js';

export const trackingRouter = Router();
trackingRouter.use(authenticate);

trackingRouter.post('/points/batch', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({ points: z.array(z.unknown()).min(1).max(500) }).parse(req.body);
    const io = req.app.get('io');
    const actor = { sub: req.auth.sub, tenantId: req.auth.tenantId, role: req.auth.role };
    const results = [];
    for (const point of input.points)
        results.push(await persistTelemetryPoint(actor, point, io));
    return res.json({ results });
});

trackingRouter.post('/heartbeat', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({
        permission: z.enum(['granted', 'denied', 'prompt', 'unavailable']),
        servicesEnabled: z.boolean(),
        battery: z.number().int().min(0).max(100).optional(),
        appState: z.enum(['active', 'background', 'inactive']).optional(),
        lastLocalFixAt: z.string().datetime().optional(),
    }).parse(req.body);
    
    const now = new Date();
    const interrupted = input.permission !== 'granted' || !input.servicesEnabled;
    const locationPermission = input.servicesEnabled ? input.permission : 'unavailable';
    const trackingState = interrupted ? 'INTERRUPTED' : 'ACTIVE';
    const appState = input.appState ?? 'unknown';

    await db.query(
        'UPDATE AgentProfile SET lastSeenAt = ?, lastHeartbeatAt = ?, batteryLevel = ?, locationPermission = ?, trackingState = ?, trackingStateAt = ?, appState = ?, appStateAt = ? WHERE userId = ?',
        [now, now, input.battery, locationPermission, trackingState, now, appState, now, req.auth.sub]
    );
    
    const [profiles] = await db.query('SELECT * FROM AgentProfile WHERE userId = ?', [req.auth.sub]);
    const profile = profiles[0];
    
    const io = req.app.get('io');
    
    if (input.permission === 'denied')
        await upsertOpenSafetyAlert({ tenantId: req.auth.tenantId, agentId: req.auth.sub, type: 'LOCATION_PERMISSION_DENIED', battery: input.battery, lastGpsAt: profile.lastLocationAt, description: 'Location permission is denied on the agent device' }, io);
    else
        await systemResolveSafetyAlerts(req.auth.tenantId, req.auth.sub, ['LOCATION_PERMISSION_DENIED'], 'Automatically resolved after location permission was restored', io);
        
    if (!input.servicesEnabled)
        await upsertOpenSafetyAlert({ tenantId: req.auth.tenantId, agentId: req.auth.sub, type: 'GPS_DISABLED', battery: input.battery, lastGpsAt: profile.lastLocationAt, description: 'GPS or device location services are disabled' }, io);
    else
        await systemResolveSafetyAlerts(req.auth.tenantId, req.auth.sub, ['GPS_DISABLED'], 'Automatically resolved after GPS services were restored', io);
        
    if (input.battery != null && input.battery <= 15)
        await upsertOpenSafetyAlert({ tenantId: req.auth.tenantId, agentId: req.auth.sub, type: 'LOW_BATTERY', battery: input.battery, lastGpsAt: profile.lastLocationAt, description: `Agent device battery is ${input.battery}%` }, io);
    else if (input.battery != null && input.battery > 20)
        await systemResolveSafetyAlerts(req.auth.tenantId, req.auth.sub, ['LOW_BATTERY'], 'Automatically resolved after battery recovered above 20%', io);
        
    const payload = {
        agentId: req.auth.sub,
        status: profile.status === 'ON_BREAK' ? 'On Break' : profile.shiftActive ? 'Active' : 'Offline',
        shiftActive: profile.shiftActive,
        socketConnected: await isUserPresent(req.auth.tenantId, req.auth.sub),
        lastHeartbeatAt: now.toISOString(),
        lastLocationAt: profile.lastLocationAt ? new Date(profile.lastLocationAt).toISOString() : undefined,
        locationPermission: profile.locationPermission,
        trackingState: profile.trackingState,
        trackingStateAt: profile.trackingStateAt ? new Date(profile.trackingStateAt).toISOString() : undefined,
        battery: profile.batteryLevel,
    };
    
    io?.to(`tenant:${req.auth.tenantId}`).emit('tracking:agent-location', payload);
    return res.json({ ok: true, serverReceivedAt: now.toISOString() });
});

trackingRouter.get('/latest', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const timeLimit = new Date(Date.now() - 8 * 3_600_000);
    
    const [rows] = await db.query(
        'SELECT * FROM LocationPing WHERE tenantId = ? AND recordedAt >= ? ORDER BY recordedAt ASC LIMIT 5000',
        [req.auth.tenantId, timeLimit]
    );
    
    const [profiles] = await db.query(
        'SELECT p.userId, p.status, p.shiftActive, p.lastHeartbeatAt, p.lastLocationAt, p.locationPermission, p.latitude, p.longitude, p.batteryLevel, p.lastSpeedKmH, p.trackingState, p.trackingStateAt, p.lastMovementAt, p.idleSince FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE u.tenantId = ? AND u.role = ?',
        [req.auth.tenantId, Role.AGENT]
    );
    
    const [openAttendances] = await db.query(
        'SELECT agentId, distanceKm, workDistanceKm, breakDistanceKm, gpsCoverage FROM Attendance WHERE tenantId = ? AND checkOutAt IS NULL',
        [req.auth.tenantId]
    );
    
    const [idleAlerts] = await db.query(
        'SELECT * FROM IdleAlert WHERE tenantId = ? AND status = ? ORDER BY createdAt DESC',
        [req.auth.tenantId, 'OPEN']
    );

    const activeShiftAgents = new Set(openAttendances.map((attendance) => attendance.agentId));
    const presentAgents = await getPresentUsers(req.auth.tenantId, profiles.map((profile) => profile.userId));
    const attendanceByAgent = new Map(openAttendances.map((attendance) => [attendance.agentId, attendance]));
    const idleByAgent = new Map(idleAlerts.map((alert) => [alert.agentId, alert]));
    
    const grouped = new Map();
    rows.forEach((row) => grouped.set(row.agentId, [...(grouped.get(row.agentId) ?? []), row]));
    
    res.json({
        agents: profiles.map((profile) => {
            const agentId = profile.userId;
            const history = grouped.get(agentId) ?? [];
            const latest = history.at(-1);
            const attendance = attendanceByAgent.get(agentId);
            const idleAlert = idleByAgent.get(agentId);
            return {
                agentId,
                latitude: profile.latitude != null ? Number(profile.latitude) : latest?.latitude != null ? Number(latest.latitude) : undefined,
                longitude: profile.longitude != null ? Number(profile.longitude) : latest?.longitude != null ? Number(latest.longitude) : undefined,
                accuracy: latest?.accuracy,
                heading: latest?.heading,
                speedKmH: profile.lastSpeedKmH ?? latest?.speedKmH,
                altitude: latest?.altitude,
                battery: profile.batteryLevel ?? latest?.battery,
                status: profile.status === 'ACTIVE'
                    ? 'Active'
                    : profile.status === 'ON_BREAK'
                        ? 'On Break'
                        : 'Offline',
                shiftActive: activeShiftAgents.has(agentId),
                socketConnected: presentAgents.has(agentId),
                lastHeartbeatAt: profile.lastHeartbeatAt ? new Date(profile.lastHeartbeatAt).toISOString() : undefined,
                lastLocationAt: profile.lastLocationAt ? new Date(profile.lastLocationAt).toISOString() : undefined,
                locationPermission: profile.locationPermission,
                trackingState: profile.trackingState,
                trackingStateAt: profile.trackingStateAt ? new Date(profile.trackingStateAt).toISOString() : undefined,
                idleStatus: idleAlert ? 'IDLE_1H' : 'MOVING',
                idleSince: idleAlert?.idleStartedAt ? new Date(idleAlert.idleStartedAt).toISOString() : (profile.idleSince ? new Date(profile.idleSince).toISOString() : undefined),
                lastMovementAt: idleAlert?.lastMovementAt ? new Date(idleAlert.lastMovementAt).toISOString() : (profile.lastMovementAt ? new Date(profile.lastMovementAt).toISOString() : undefined),
                idleAlert: idleAlert ? {
                    id: idleAlert.id,
                    latitude: idleAlert.latitude,
                    longitude: idleAlert.longitude,
                    idleStartedAt: new Date(idleAlert.idleStartedAt).toISOString(),
                    lastMovementAt: new Date(idleAlert.lastMovementAt).toISOString(),
                    lastGpsAt: new Date(idleAlert.lastGpsAt).toISOString(),
                    battery: idleAlert.battery,
                } : undefined,
                distanceKm: attendance?.distanceKm ?? 0,
                workDistanceKm: attendance?.workDistanceKm ?? 0,
                breakDistanceKm: attendance?.breakDistanceKm ?? 0,
                gpsCoverage: attendance?.gpsCoverage ?? 0,
                deviceTimestamp: latest?.deviceRecordedAt ? new Date(latest.deviceRecordedAt).toISOString() : (latest?.recordedAt ? new Date(latest.recordedAt).toISOString() : undefined),
                serverReceivedAt: latest?.recordedAt ? new Date(latest.recordedAt).toISOString() : undefined,
                lastUpdatedAt: latest?.deviceRecordedAt ? new Date(latest.deviceRecordedAt).toISOString() : (latest?.recordedAt ? new Date(latest.recordedAt).toISOString() : undefined),
                travelledPath: history.map((point) => ({
                    lat: point.latitude,
                    lng: point.longitude,
                    timestamp: point.deviceRecordedAt ? new Date(point.deviceRecordedAt).toISOString() : new Date(point.recordedAt).toISOString(),
                })),
            };
        }),
    });
});

trackingRouter.get('/route', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const query = z.object({
        originLat: z.coerce.number().min(-90).max(90),
        originLng: z.coerce.number().min(-180).max(180),
        destinationLat: z.coerce.number().min(-90).max(90),
        destinationLng: z.coerce.number().min(-180).max(180),
    }).parse(req.query);
    if (query.originLat === 0 && query.originLng === 0 ||
        query.destinationLat === 0 && query.destinationLng === 0) {
        return res.status(400).json({
            error: { code: 'INVALID_COORDINATES', message: 'Route coordinates 0,0 are not allowed.' },
        });
    }
    const coordinates = `${query.originLng},${query.originLat};${query.destinationLng},${query.destinationLat}`;
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        return res.status(502).json({
            error: { code: 'ROUTING_UNAVAILABLE', message: 'Road routing service is unavailable.' },
        });
    }
    const payload = await response.json();
    const route = payload.routes?.[0];
    if (payload.code !== 'Ok' || !route) {
        return res.status(404).json({
            error: { code: 'ROUTE_NOT_FOUND', message: 'No drivable route was found.' },
        });
    }
    return res.json({
        path: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        distanceKm: Number((route.distance / 1000).toFixed(1)),
        etaMinutes: Math.max(1, Math.round(route.duration / 60)),
    });
});

trackingRouter.get('/:agentId/history', async (req, res) => {
    if (req.auth.role === Role.AGENT && req.auth.sub !== req.params.agentId)
        return res.status(403).json({ error: { code: 'FORBIDDEN' } });
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 8 * 3_600_000);
    
    const [history] = await db.query(
        'SELECT * FROM LocationPing WHERE tenantId = ? AND agentId = ? AND recordedAt >= ? ORDER BY recordedAt ASC LIMIT 5000',
        [req.auth.tenantId, req.params.agentId, from]
    );
    res.json(history);
});
