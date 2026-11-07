import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { LOCAL_STORAGE_DIR } from './modules/files/object-storage.service.js';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { distributedRateLimit } from './middleware/distributedRateLimit.js';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { apiRouter } from './routes/index.js';
import { swaggerDocument } from './docs/swagger.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { checkRedisReadiness } from './lib/redis.js';
import { rejectUnsafeInput } from './middleware/requestSecurity.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { requireAppVersion } from './middleware/appVersion.js';
import { authenticate } from './middleware/auth.js';

import { broadcastRouter } from './modules/broadcast/broadcast.routes.js';
export const isContactLookupPath = (pathName) => pathName === '/api/v1/contacts' || pathName.startsWith('/api/v1/contacts/');
export const createApp = () => {
    const app = express();
    const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
    const frontendIndex = path.join(frontendDist, 'index.html');
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
    app.disable('x-powered-by');
    app.use(pinoHttp({ logger }));
    app.use((req, res, next) => {
        if (env.NODE_ENV !== 'production' || !env.ENFORCE_HTTPS || req.secure)
            return next();
        logger.warn({ event: 'insecure-request', method: req.method, path: req.path, ip: req.ip }, 'Insecure production request rejected');
        if (req.method === 'GET' || req.method === 'HEAD') {
            return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
        }
        return res.status(400).json({ error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' } });
    });
    app.use(helmet({
        strictTransportSecurity: env.NODE_ENV === 'production'
            ? { maxAge: env.HSTS_MAX_AGE_SECONDS, includeSubDomains: true }
            : false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: {
            directives: {
                scriptSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
                connectSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
                frameSrc: ["'self'", 'https://www.openstreetmap.org'],
                workerSrc: ["'self'", 'blob:'],
            },
        },
    }));
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || env.CORS_ORIGINS.includes(origin))
                return callback(null, true);
            logger.warn({ event: 'cors-origin-denied', origin }, 'CORS origin denied');
            return callback(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Client-Platform', 'X-CSRF-Token', 'X-Idempotency-Key'],
        exposedHeaders: ['Content-Disposition', 'Content-Type', 'Retry-After'],
    }));
    app.use(distributedRateLimit('global', {
        windowMs: 60_000,
        limit: 300,
        standardHeaders: true,
        legacyHeaders: false,
        // Contact lookups have their own authenticated, per-user limiter. Keeping
        // them out of the shared IP bucket prevents GPS traffic or multiple open
        // portal tabs from blocking the WhatsApp button for everyone on one NAT.
        skip: (req) => req.path.startsWith('/health') || isContactLookupPath(req.path),
    }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use(cookieParser());
    app.use(rejectUnsafeInput);
    app.use(sanitizeInput);
    app.use(requireAppVersion);
    
    // Explicitly set Permissions-Policy since Helmet does not set it by default
    app.use((_req, res, next) => {
        res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=(), payment=()');
        next();
    });
    
    app.use('/api', (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    app.get('/health', async (_req, res) => {
        const redisResult = await Promise.allSettled([checkRedisReadiness()]).then(r => r[0]);
        const redis = redisResult.status === 'fulfilled'
            ? redisResult.value.enabled
                ? { status: 'ok', latencyMs: redisResult.value.latencyMs }
                : { status: 'disabled' }
            : { status: 'degraded' };
        const body = {
            status: redis.status === 'degraded' ? 'degraded' : 'ok',
            service: 'reproutes-api',
            timestamp: new Date().toISOString(),
            dependencies: {
                redis,
            },
        };
        res.status(200).json(body);
    });
    app.get('/health/live', (_req, res) => res.json({ status: 'ok', service: 'reproutes-api' }));
    app.get('/health/ready', async (req, res) => {
        if (req.app.get('draining'))
            return res.status(503).json({ status: 'draining', service: 'reproutes-api' });
        try {
            const redis = await checkRedisReadiness().catch(() => ({ enabled: false, degraded: true }));
            res.json({ status: 'ok', service: 'reproutes-api', dependencies: { redis: 'degraded' in redis ? { status: 'degraded' } : redis.enabled ? { status: 'ok', latencyMs: redis.latencyMs } : { status: 'disabled' } } });
        }
        catch (error) {
            logger.error({ err: error }, 'Dependency readiness check failed');
            res.status(503).json({ status: 'unavailable', service: 'reproutes-api' });
        }
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    app.use('/api', broadcastRouter);
    app.use('/api/v1', apiRouter);
    // Local media storage
    // Files are written by object-storage.service.ts and served here directly.
    const mediaStorageDir = path.isAbsolute(LOCAL_STORAGE_DIR)
        ? LOCAL_STORAGE_DIR
        : path.resolve(process.cwd(), LOCAL_STORAGE_DIR);
    const legacyMediaDir = path.resolve(process.cwd(), 'media');

    app.use('/media', express.static(mediaStorageDir, {
        maxAge: '1h',
        dotfiles: 'deny',
        index: false,
    }));
    app.use('/media', express.static(legacyMediaDir, {
        maxAge: '1h',
        dotfiles: 'deny',
        index: false,
    }));
    app.use('/uploads', express.static(mediaStorageDir, {
        maxAge: '1h',
        dotfiles: 'deny',
        index: false,
    }));
    app.use('/uploads', express.static(legacyMediaDir, {
        maxAge: '1h',
        dotfiles: 'deny',
        index: false,
    }));
    if (fs.existsSync(frontendIndex)) {
        app.use(express.static(frontendDist, { 
            maxAge: env.NODE_ENV === 'production' ? '1d' : 0,
            dotfiles: 'deny'
        }));
        app.use((req, res, next) => {
            if (req.method !== 'GET' || !req.accepts('html')) {
                next();
                return;
            }
            res.sendFile(frontendIndex);
        });
    }
    app.use(notFound);
    app.use(errorHandler);
    return app;
};
