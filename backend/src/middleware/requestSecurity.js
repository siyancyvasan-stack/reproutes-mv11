import { logger } from '../config/logger.js';
const hasUnsafeKey = (value, depth = 0) => {
    if (depth > 12 || value === null || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item) => hasUnsafeKey(item, depth + 1));
    return Object.entries(value).some(([key, nested]) => key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype' || hasUnsafeKey(nested, depth + 1));
};
export const rejectUnsafeInput = (req, res, next) => {
    if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
        logger.warn({ event: 'unsafe-input-rejected', method: req.method, path: req.path, ip: req.ip }, 'Unsafe request input rejected');
        return res.status(422).json({ error: { code: 'UNSAFE_INPUT', message: 'Request contains unsupported field names' } });
    }
    return next();
};
