import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import db from '../../lib/db.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit) || 30);
    const [rows] = await db.query(
        'SELECT * FROM Notification WHERE tenantId = ? AND (userId IS NULL OR userId = ?) ORDER BY createdAt DESC LIMIT ?',
        [req.auth.tenantId, req.auth.sub, limit]
    );
    res.json(rows);
});

notificationRouter.patch('/:id/read', async (req, res) => {
    const [result] = await db.query(
        'UPDATE Notification SET readAt = NOW(), updatedAt = NOW() WHERE id = ? AND tenantId = ? AND (userId IS NULL OR userId = ?)',
        [req.params.id, req.auth.tenantId, req.auth.sub]
    );
    res.status(result.affectedRows > 0 ? 204 : 404).send();
});
