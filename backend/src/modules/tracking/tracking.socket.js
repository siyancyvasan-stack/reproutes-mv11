import { Role } from '../../lib/enums.js';
import { z } from 'zod';
import { verifyAccessToken } from '../../lib/jwt.js';
import db from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { persistTelemetryPoint } from './tracking.service.js';
import { upsertOpenSafetyAlert } from '../safety/safety.service.js';
import { removePresence, touchPresence } from './presence.service.js';

const locationPermissionSchema = z.object({
    permission: z.enum(['granted', 'denied', 'prompt', 'unavailable']),
});

export const configureTrackingSocket = (io) => {
    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth.token ?? socket.handshake.headers.authorization?.replace('Bearer ', '');
            socket.data.auth = verifyAccessToken(token);
            next();
        }
        catch {
            next(new Error('UNAUTHENTICATED'));
        }
    });

    io.on('connection', (socket) => {
        const auth = socket.data.auth;
        logger.info({
            event: socket.recovered ? 'socket-reconnect' : 'socket-connect',
            userId: auth.sub,
            role: auth.role,
            socketId: socket.id,
        }, 'Tracking socket connected');

        let presenceTimer;
        void touchPresence(auth.tenantId, auth.sub, socket.id).catch((error) => logger.error({ err: error, userId: auth.sub }, 'Presence registration failed'));

        socket.join(`tenant:${auth.tenantId}`);
        socket.join(`user:${auth.sub}`);
        socket.join(`tenant:${auth.tenantId}:role:${auth.role}`);

        if (auth.role === Role.AGENT) {
            socket.join(`agent:${auth.sub}`);

            const publishPresence = async () => {
                await touchPresence(auth.tenantId, auth.sub, socket.id);
                const presenceAt = new Date();
                
                const [attendances] = await db.query('SELECT id FROM Attendance WHERE agentId = ? AND checkOutAt IS NULL LIMIT 1', [auth.sub]);
                const openAttendance = attendances[0];
                
                await db.query(
                    'UPDATE AgentProfile SET lastSeenAt = ?, lastHeartbeatAt = ?, shiftActive = ? WHERE userId = ?',
                    [presenceAt, presenceAt, Boolean(openAttendance), auth.sub]
                );
                
                const [profiles] = await db.query('SELECT status, shiftActive, lastLocationAt, locationPermission, latitude, longitude, batteryLevel, lastSpeedKmH, trackingState FROM AgentProfile WHERE userId = ?', [auth.sub]);
                const profile = profiles[0];

                if (profile) {
                    io.to(`tenant:${auth.tenantId}`).emit('tracking:agent-location', {
                        agentId: auth.sub,
                        latitude: profile.latitude != null ? Number(profile.latitude) : undefined,
                        longitude: profile.longitude != null ? Number(profile.longitude) : undefined,
                        speedKmH: profile.lastSpeedKmH,
                        battery: profile.batteryLevel,
                        status: profile.status === 'ACTIVE' ? 'Active' : profile.status === 'ON_BREAK' ? 'On Break' : 'Offline',
                        shiftActive: profile.shiftActive,
                        socketConnected: true,
                        lastHeartbeatAt: presenceAt.toISOString(),
                        lastLocationAt: profile.lastLocationAt ? new Date(profile.lastLocationAt).toISOString() : undefined,
                        locationPermission: profile.locationPermission,
                        trackingState: profile.trackingState,
                    });
                }
            };

            void publishPresence().catch((error) => logger.error({ error, agentId: auth.sub }, 'Agent presence update failed'));
            
            presenceTimer = setInterval(() => {
                void publishPresence().catch((error) => logger.error({ error, agentId: auth.sub }, 'Agent presence heartbeat failed'));
            }, 20_000);
        }

        socket.on('tracking:update', async (payload, acknowledge) => {
            try {
                acknowledge?.(await persistTelemetryPoint(auth, payload, io));
            }
            catch (error) {
                logger.error({ error, agentId: auth.sub }, 'Location persistence failed');
                acknowledge?.({ ok: false, error: 'PERSISTENCE_ERROR' });
            }
        });

        socket.on('tracking:batch', async (payload, acknowledge) => {
            if (auth.role !== Role.AGENT)
                return acknowledge?.({ ok: false, error: 'FORBIDDEN' });

            const parsed = z.array(z.unknown()).min(1).max(500).safeParse(payload);
            if (!parsed.success)
                return acknowledge?.({ ok: false, error: 'VALIDATION_ERROR' });

            const results = [];
            for (const point of parsed.data) {
                try {
                    const result = await persistTelemetryPoint(auth, point, io);
                    results.push(result);
                }
                catch (error) {
                    logger.error({ error, agentId: auth.sub }, 'Queued location persistence failed');
                    const clientPointId = point && typeof point === 'object' && 'clientPointId' in point
                        ? String(point.clientPointId ?? '') || undefined
                        : undefined;
                    results.push(clientPointId
                        ? { ok: false, error: 'PERSISTENCE_ERROR', clientPointId }
                        : { ok: false, error: 'PERSISTENCE_ERROR' });
                }
            }
            
            acknowledge?.({ ok: true, results });
        });

        socket.on('tracking:location-permission', async (payload, acknowledge) => {
            if (auth.role !== Role.AGENT)
                return acknowledge?.({ ok: false, error: 'FORBIDDEN' });

            const parsed = locationPermissionSchema.safeParse(payload);
            if (!parsed.success)
                return acknowledge?.({ ok: false, error: 'VALIDATION_ERROR' });

            try {
                await db.query(
                    'UPDATE AgentProfile SET locationPermission = ? WHERE userId = ?',
                    [parsed.data.permission, auth.sub]
                );
                
                const [profiles] = await db.query('SELECT shiftActive, lastHeartbeatAt, lastLocationAt, locationPermission FROM AgentProfile WHERE userId = ?', [auth.sub]);
                const profile = profiles[0];

                if (profile) {
                    io.to(`tenant:${auth.tenantId}`).emit('tracking:agent-location', {
                        agentId: auth.sub,
                        shiftActive: profile.shiftActive,
                        socketConnected: true,
                        lastHeartbeatAt: profile.lastHeartbeatAt ? new Date(profile.lastHeartbeatAt).toISOString() : undefined,
                        lastLocationAt: profile.lastLocationAt ? new Date(profile.lastLocationAt).toISOString() : undefined,
                        locationPermission: profile.locationPermission,
                    });
                }
                acknowledge?.({ ok: true });
            }
            catch (error) {
                logger.error({ error, agentId: auth.sub }, 'Location permission update failed');
                acknowledge?.({ ok: false, error: 'PERSISTENCE_ERROR' });
            }
        });

        socket.on('chat:typing', (payload) => {
            const parsed = z.object({ recipientId: z.string().min(1), typing: z.boolean() }).safeParse(payload);
            if (!parsed.success)
                return;
            io.to(`user:${parsed.data.recipientId}`).emit('chat:typing', {
                userId: auth.sub,
                typing: parsed.data.typing,
            });
        });

        socket.on('disconnect', (reason) => {
            logger.info({ event: 'socket-disconnect', userId: auth.sub, role: auth.role, reason }, 'Tracking socket disconnected');
            if (auth.role !== Role.AGENT)
                return;
                
            if (presenceTimer)
                clearInterval(presenceTimer);
                
            void removePresence(auth.tenantId, auth.sub, socket.id).then(async (stillPresent) => {
                if (stillPresent)
                    return;
                    
                const [profiles] = await db.query('SELECT shiftActive, lastHeartbeatAt, lastLocationAt, locationPermission, latitude, longitude, batteryLevel, lastSpeedKmH, trackingState FROM AgentProfile WHERE userId = ?', [auth.sub]);
                const profile = profiles[0];
                
                if (profile) {
                    io.to(`tenant:${auth.tenantId}`).emit('tracking:agent-location', {
                        agentId: auth.sub,
                        latitude: profile.latitude != null ? Number(profile.latitude) : undefined,
                        longitude: profile.longitude != null ? Number(profile.longitude) : undefined,
                        battery: profile.batteryLevel,
                        speedKmH: profile.lastSpeedKmH,
                        trackingState: profile.trackingState,
                        shiftActive: profile.shiftActive,
                        socketConnected: false,
                        lastHeartbeatAt: profile.lastHeartbeatAt ? new Date(profile.lastHeartbeatAt).toISOString() : undefined,
                        lastLocationAt: profile.lastLocationAt ? new Date(profile.lastLocationAt).toISOString() : undefined,
                        locationPermission: profile.locationPermission,
                    });
                }
            }).catch((error) => logger.error({ error, agentId: auth.sub }, 'Agent disconnect state update failed'));
            
            setTimeout(() => {
                void db.query('SELECT lastSeenAt, lastLocationAt, latitude, longitude, batteryLevel FROM AgentProfile WHERE userId = ?', [auth.sub]).then(async ([profiles]) => {
                    const profile = profiles[0];
                    if (!profile?.lastSeenAt || Date.now() - new Date(profile.lastSeenAt).getTime() < 55_000)
                        return;
                        
                    await upsertOpenSafetyAlert({
                        tenantId: auth.tenantId, agentId: auth.sub, type: 'OFFLINE',
                        description: 'Agent connection lost for more than 90 seconds',
                        alertStartedAt: new Date(profile.lastSeenAt), lastGpsAt: profile.lastLocationAt ? new Date(profile.lastLocationAt) : undefined,
                        latitude: profile.latitude, longitude: profile.longitude, battery: profile.batteryLevel,
                    }, io);
                }).catch(() => undefined);
            }, 90_000).unref();
        });
    });
};
