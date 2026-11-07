import http from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeRedis, connectRedis, createRedisSubscriber, getRedis, redisEnabled } from './lib/redis.js';
import { configureTrackingSocket } from './modules/tracking/tracking.socket.js';
import { pruneExpiredLocationHistory, sweepIdleAlerts } from './modules/tracking/tracking.service.js';
import { sweepSafetyAlerts } from './modules/safety/safety.service.js';
const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Allow polling fallback when the production reverse proxy does not
    // forward WebSocket upgrades. Live tracking must still work in that case.
    transports: ['websocket', 'polling'],
    pingInterval: 20_000,
    pingTimeout: 20_000,
    connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
});
app.set('io', io);
configureTrackingSocket(io);
let shuttingDown = false;
let subscriber;
let idleSweepTimer;
let gpsRetentionTimer;
const pruneGpsHistory = () => void pruneExpiredLocationHistory(env.GPS_HISTORY_RETENTION_DAYS)
    .then((result) => result.count && logger.info({ deletedPoints: result.count, retentionDays: env.GPS_HISTORY_RETENTION_DAYS }, 'Expired raw GPS history pruned'))
    .catch((error) => logger.error({ err: error }, 'GPS history retention sweep failed'));
const shutdown = async (signal) => {
    if (shuttingDown)
        return;
    shuttingDown = true;
    app.set('draining', true);
    logger.info({ signal, graceMs: env.SHUTDOWN_GRACE_MS }, 'Graceful shutdown started');
    if (idleSweepTimer)
        clearInterval(idleSweepTimer);
    if (gpsRetentionTimer)
        clearInterval(gpsRetentionTimer);
    const forceTimer = setTimeout(() => {
        logger.fatal({ signal }, 'Graceful shutdown deadline exceeded');
        server.closeAllConnections();
        process.exit(1);
    }, env.SHUTDOWN_GRACE_MS);
    forceTimer.unref();
    try {
        const httpClosed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await new Promise((resolve) => io.close(() => resolve()));
        await httpClosed;
        await closeRedis(subscriber);
        clearTimeout(forceTimer);
        logger.info({ signal }, 'Graceful shutdown completed');
        process.exitCode = 0;
    }
    catch (error) {
        logger.error({ err: error, signal }, 'Graceful shutdown failed');
        process.exitCode = 1;
    }
};
const start = async () => {
    await connectRedis();
    if (redisEnabled()) {
        subscriber = await createRedisSubscriber();
        io.adapter(createAdapter(getRedis(), subscriber));
    }
    idleSweepTimer = setInterval(() => {
        void sweepIdleAlerts(io).catch((error) => logger.error({ err: error }, 'Idle tracking sweep failed'));
        void sweepSafetyAlerts(io).catch((error) => logger.error({ err: error }, 'Safety alert sweep failed'));
    }, 60_000);
    idleSweepTimer.unref();
    pruneGpsHistory();
    gpsRetentionTimer = setInterval(pruneGpsHistory, 24 * 60 * 60_000);
    gpsRetentionTimer.unref();
    server.requestTimeout = 30_000;
    server.headersTimeout = 35_000;
    server.keepAliveTimeout = 10_000;
    server.listen(env.PORT, env.HOST, () => logger.info({ host: env.HOST, port: env.PORT, redis: redisEnabled() }, 'Reproutes API listening'));
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => logger.error({ err: error }, 'Unhandled promise rejection'));
start().catch(async (error) => {
    logger.fatal({ err: error }, 'Application startup failed');
    await closeRedis(subscriber);
    process.exitCode = 1;
});
