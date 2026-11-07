import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { randomUUID } from 'node:crypto';

export const mobileRouter = Router();
mobileRouter.use(authenticate);

mobileRouter.post('/devices', async (req, res) => {
    const input = z.object({ token: z.string().min(10), provider: z.enum(['EXPO', 'FCM', 'APNS']), platform: z.string().optional(), deviceName: z.string().optional() }).parse(req.body);
    
    const [existing] = await db.query('SELECT id FROM MobileDevice WHERE token = ?', [input.token]);
    
    let device;
    if (existing.length > 0) {
        await db.query(
            'UPDATE MobileDevice SET provider = ?, platform = ?, deviceName = ?, tenantId = ?, userId = ?, enabled = ?, lastSeenAt = NOW(), updatedAt = NOW() WHERE token = ?',
            [input.provider, input.platform || null, input.deviceName || null, req.auth.tenantId, req.auth.sub, true, input.token]
        );
        const [rows] = await db.query('SELECT * FROM MobileDevice WHERE token = ?', [input.token]);
        device = rows[0];
    } else {
        const id = randomUUID();
        await db.query(
            'INSERT INTO MobileDevice (id, tenantId, userId, token, provider, platform, deviceName, enabled, lastSeenAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
            [id, req.auth.tenantId, req.auth.sub, input.token, input.provider, input.platform || null, input.deviceName || null, true]
        );
        const [rows] = await db.query('SELECT * FROM MobileDevice WHERE id = ?', [id]);
        device = rows[0];
    }
    
    res.status(201).json(device);
});

mobileRouter.delete('/devices/:token', async (req, res) => {
    await db.query(
        'UPDATE MobileDevice SET enabled = ?, updatedAt = NOW() WHERE token = ? AND tenantId = ? AND userId = ?',
        [false, req.params.token, req.auth.tenantId, req.auth.sub]
    );
    res.status(204).send();
});
