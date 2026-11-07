import { verifyAccessToken } from '../lib/jwt.js';
import { logger } from '../config/logger.js';
import db from '../lib/db.js';
export const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined;
    if (!token) {
        logger.warn({ event: 'authentication-failed', reason: 'missing-token', method: req.method, path: req.path, ip: req.ip }, 'Authentication failed');
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Access token required' } });
    }
    try {
        const claims = verifyAccessToken(token);
        const [rows] = await db.query(
            'SELECT id, tenantId, role, email FROM User WHERE id = ? AND tenantId = ? AND status = ? LIMIT 1',
            [claims.sub, claims.tenantId, 'ACTIVE']
        );
        const user = rows[0];
        if (!user)
            throw new Error('Account is inactive or unavailable');
        req.auth = { sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email };
        return next();
    }
    catch (error) {
        if (error.message === 'Account is inactive or unavailable' || error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            logger.warn({ event: 'authentication-failed', reason: 'invalid-token', method: req.method, path: req.path, ip: req.ip }, 'Authentication failed');
            return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Access token is invalid or expired' } });
        }
        logger.error({ event: 'authentication-error', err: error, method: req.method, path: req.path, ip: req.ip }, 'Unexpected error during authentication');
        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred during authentication' } });
    }
};
export const authorize = (...roles) => (req, res, next) => {
    const allowedRoles = [...roles];
    if (allowedRoles.includes('MANAGER') && !allowedRoles.includes('ADMIN')) {
        allowedRoles.push('ADMIN');
    }

    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
        logger.warn({ event: 'authorization-denied', method: req.method, path: req.path, ip: req.ip, userId: req.auth?.sub, tenantId: req.auth?.tenantId, role: req.auth?.role, allowedRoles: roles }, 'Authorization denied');
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    return next();
};
