import { Router } from 'express';
import { distributedRateLimit } from '../../middleware/distributedRateLimit.js';
import { authenticate } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { runExport } from './export.service.js';
import { randomUUID } from 'node:crypto';

export const exportRouter = Router();

exportRouter.use(authenticate, distributedRateLimit('exports', { 
    windowMs: 60_000, 
    limit: 8, 
    standardHeaders: true, 
    legacyHeaders: false, 
    message: { error: { code: 'EXPORT_RATE_LIMITED', message: 'Too many export requests. Please wait before trying again.' } } 
}));

const active = new Set();

exportRouter.get('/:dataset/:format', async (req, res) => {
    const dataset = String(req.params.dataset).toLowerCase();
    const format = String(req.params.format).toLowerCase();
    
    if (!['csv', 'xlsx', 'pdf'].includes(format))
        return res.status(422).json({ error: { code: 'INVALID_EXPORT_FORMAT', message: 'Use csv, xlsx, or pdf.' } });
        
    const key = `${req.auth.sub}:${dataset}:${format}:${JSON.stringify(req.query)}`;
    
    if (active.has(key))
        return res.status(429).json({ error: { code: 'EXPORT_IN_PROGRESS', message: 'An identical export is already being generated.' } });
        
    active.add(key);
    
    try {
        const error = await runExport(dataset, format, req.auth, req.query, res);
        
        await db.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
            [randomUUID(), req.auth.tenantId, req.auth.sub, error ? `EXPORT_${error.code}` : 'EXPORT_GENERATED', 'Export', JSON.stringify({ dataset, format, filters: req.query }), new Date()]
        ).catch(() => undefined);
        
        if (error && !res.headersSent)
            return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    finally {
        active.delete(key);
    }
});
