import { Role } from '../../lib/enums.js';
import { Router } from 'express';
import { distributedRateLimit } from '../../middleware/distributedRateLimit.js';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { redirectToSignedObject, uploadObject } from '../files/object-storage.service.js';
import db from '../../lib/db.js';
import { randomUUID } from 'node:crypto';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|audio\/(webm|mpeg|wav|ogg|mp4)|application\/pdf)$/;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, ALLOWED_MIME.test(file.mimetype)),
});

const sendLimiter = distributedRateLimit('broadcast', {
    windowMs: 30_000,
    limit: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth.sub,
    handler: (_req, res) => res.status(429).json({ error: { code: 'BROADCAST_RATE_LIMITED', message: 'Please wait 30 seconds before sending another broadcast' } }),
});

const attachmentPath = (message) => message.attachmentUrl ?? message.voiceNoteUrl;

const serialize = (message) => ({
    id: message.id,
    senderId: message.senderId,
    messageText: message.messageText,
    attachmentUrl: message.attachmentUrl ? `/api/manager/broadcast/${message.id}/attachment` : null,
    voiceNoteUrl: message.voiceNoteUrl ? `/api/manager/broadcast/${message.id}/attachment` : null,
    attachmentName: message.attachmentName,
    attachmentMime: message.attachmentMime,
    createdAt: message.createdAt,
    receipts: message.receipts ?? [],
    delivery: message.receipts ? {
        total: message.receipts.length,
        delivered: message.receipts.filter((receipt) => receipt.deliveredAt).length,
        read: message.receipts.filter((receipt) => receipt.readAt).length,
    } : undefined,
});

export const broadcastRouter = Router();

broadcastRouter.use(['/manager/broadcast', '/agent/broadcast'], authenticate);

broadcastRouter.post('/manager/broadcast', authorize(Role.MANAGER, Role.ADMIN), sendLimiter, upload.single('file'), async (req, res) => {
    const input = z.object({
        messageText: z.string().max(4000).default(''),
        type: z.enum(['TEXT', 'FILE', 'VOICE']).default('TEXT'),
    }).parse(req.body);
    
    if (!input.messageText.trim() && !req.file) {
        return res.status(422).json({ error: { code: 'MESSAGE_EMPTY', message: 'A message or attachment is required' } });
    }
    
    let storedKey;
    if (req.file) {
        storedKey = (await uploadObject({ tenantId: req.auth.tenantId, folder: 'broadcast', originalName: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer })).storageKey;
    }
    
    const tenantId = req.auth.tenantId;
    const [agents] = await db.query('SELECT id FROM User WHERE tenantId = ? AND role = ? AND status = ?', [tenantId, Role.AGENT, 'ACTIVE']);
    
    const messageId = randomUUID();
    const createdAt = new Date();
    
    const attachmentUrl = req.file && input.type !== 'VOICE' ? storedKey : null;
    const voiceNoteUrl = req.file && input.type === 'VOICE' ? storedKey : null;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let message;
    try {
        await connection.query(
            'INSERT INTO broadcast_messages (id, tenantId, senderId, messageText, attachmentUrl, voiceNoteUrl, attachmentName, attachmentMime, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [messageId, tenantId, req.auth.sub, input.messageText.trim(), attachmentUrl, voiceNoteUrl, req.file?.originalname ?? null, req.file?.mimetype ?? null, createdAt]
        );
        
        if (agents.length > 0) {
            const values = agents.map(a => `(UUID(), '${tenantId}', '${messageId}', '${a.id}')`).join(',');
            await connection.query(`INSERT INTO broadcast_receipts (id, tenantId, broadcastId, agentId) VALUES ${values}`);
        }
        
        const [msgRes] = await connection.query('SELECT * FROM broadcast_messages WHERE id = ?', [messageId]);
        const [receiptsRes] = await connection.query('SELECT * FROM broadcast_receipts WHERE broadcastId = ?', [messageId]);
        
        message = msgRes[0];
        message.receipts = receiptsRes;
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const io = req.app.get('io');
    const connected = io ? await io.in(`tenant:${tenantId}:role:${Role.AGENT}`).fetchSockets() : [];
    const connectedAgentIds = [...new Set(connected.map((socket) => String(socket.data.auth?.sub ?? '')).filter(Boolean))];
    
    if (connectedAgentIds.length) {
        const deliveredAt = new Date();
        const placeholders = connectedAgentIds.map(() => '?').join(',');
        await db.query(
            `UPDATE broadcast_receipts SET deliveredAt = ? WHERE tenantId = ? AND broadcastId = ? AND agentId IN (${placeholders})`,
            [deliveredAt, tenantId, message.id, ...connectedAgentIds]
        );
        
        message.receipts.forEach((receipt) => {
            if (connectedAgentIds.includes(receipt.agentId))
                receipt.deliveredAt = deliveredAt;
        });
    }
    
    const payload = serialize(message);
    io?.to(`tenant:${tenantId}:role:${Role.AGENT}`).emit('broadcast:message', payload);
    io?.to(`user:${req.auth.sub}`).emit('broadcast:status', payload);
    return res.status(201).json(payload);
});

broadcastRouter.get('/manager/broadcast/history', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const { page, limit } = z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    
    const tenantId = req.auth.tenantId;
    
    const [countRes] = await db.query('SELECT COUNT(*) as c FROM broadcast_messages WHERE tenantId = ?', [tenantId]);
    const total = countRes[0].c;
    
    const [items] = await db.query(
        'SELECT * FROM broadcast_messages WHERE tenantId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
        [tenantId, limit, (page - 1) * limit]
    );
    
    if (items.length > 0) {
        const itemIds = items.map(i => i.id);
        const placeholders = itemIds.map(() => '?').join(',');
        
        const [receipts] = await db.query(`SELECT * FROM broadcast_receipts WHERE broadcastId IN (${placeholders})`, itemIds);
        
        const receiptsMap = new Map();
        receipts.forEach(r => {
            if (!receiptsMap.has(r.broadcastId)) receiptsMap.set(r.broadcastId, []);
            receiptsMap.get(r.broadcastId).push(r);
        });
        
        items.forEach(i => {
            i.receipts = receiptsMap.get(i.id) ?? [];
        });
    }
    
    return res.json({ items: items.reverse().map(serialize), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

broadcastRouter.get('/agent/broadcast/inbox', authorize(Role.AGENT), async (req, res) => {
    const { page, limit } = z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    
    const tenantId = req.auth.tenantId;
    const agentId = req.auth.sub;
    
    const [countRes] = await db.query('SELECT COUNT(*) as c FROM broadcast_receipts WHERE tenantId = ? AND agentId = ?', [tenantId, agentId]);
    const total = countRes[0].c;
    
    const [receipts] = await db.query(
        `SELECT r.*, m.id as m_id, m.senderId, m.messageText, m.attachmentUrl, m.voiceNoteUrl, m.attachmentName, m.attachmentMime, m.createdAt as m_createdAt 
         FROM broadcast_receipts r 
         JOIN broadcast_messages m ON r.broadcastId = m.id 
         WHERE r.tenantId = ? AND r.agentId = ? 
         ORDER BY m.createdAt DESC LIMIT ? OFFSET ?`,
        [tenantId, agentId, limit, (page - 1) * limit]
    );
    
    const undelivered = receipts.filter((receipt) => !receipt.deliveredAt).map((receipt) => receipt.broadcastId);
    const deliveredAt = new Date();
    
    if (undelivered.length) {
        const placeholders = undelivered.map(() => '?').join(',');
        await db.query(
            `UPDATE broadcast_receipts SET deliveredAt = ? WHERE tenantId = ? AND agentId = ? AND broadcastId IN (${placeholders})`,
            [deliveredAt, tenantId, agentId, ...undelivered]
        );
    }
    
    const items = receipts.reverse().map((receipt) => {
        const broadcast = {
            id: receipt.m_id,
            senderId: receipt.senderId,
            messageText: receipt.messageText,
            attachmentUrl: receipt.attachmentUrl,
            voiceNoteUrl: receipt.voiceNoteUrl,
            attachmentName: receipt.attachmentName,
            attachmentMime: receipt.attachmentMime,
            createdAt: receipt.m_createdAt
        };
        return {
            ...serialize(broadcast),
            receipt: { deliveredAt: receipt.deliveredAt ?? deliveredAt, readAt: receipt.readAt }
        };
    });
    
    return res.json({
        items,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
});

broadcastRouter.patch('/agent/broadcast/:id/read', authorize(Role.AGENT), async (req, res) => {
    const tenantId = req.auth.tenantId;
    const agentId = req.auth.sub;
    const broadcastId = String(req.params.id);
    
    const [receipts] = await db.query('SELECT * FROM broadcast_receipts WHERE tenantId = ? AND agentId = ? AND broadcastId = ?', [tenantId, agentId, broadcastId]);
    const receipt = receipts[0];
    
    if (!receipt)
        return res.status(404).json({ error: { code: 'BROADCAST_NOT_FOUND', message: 'Broadcast not found' } });
        
    const now = new Date();
    await db.query(
        'UPDATE broadcast_receipts SET deliveredAt = ?, readAt = ? WHERE broadcastId = ? AND agentId = ?',
        [receipt.deliveredAt ?? now, now, broadcastId, agentId]
    );
    
    const [updatedRows] = await db.query('SELECT * FROM broadcast_receipts WHERE broadcastId = ? AND agentId = ?', [broadcastId, agentId]);
    const updated = updatedRows[0];
    
    req.app.get('io')?.to(`user:${agentId}`).emit('broadcast:read', updated);
    
    const [messages] = await db.query('SELECT senderId FROM broadcast_messages WHERE id = ? AND tenantId = ?', [broadcastId, tenantId]);
    const message = messages[0];
    
    if (message)
        req.app.get('io')?.to(`user:${message.senderId}`).emit('broadcast:status', { broadcastId });
        
    return res.json(updated);
});

broadcastRouter.get(['/manager/broadcast/:id/attachment', '/agent/broadcast/:id/attachment'], async (req, res) => {
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const [messages] = await db.query('SELECT * FROM broadcast_messages WHERE id = ? AND tenantId = ?', [id, tenantId]);
    const message = messages[0];
    
    if (!message || !attachmentPath(message))
        return res.status(404).send();
        
    if (req.auth.role === Role.AGENT) {
        const [receipts] = await db.query('SELECT id FROM broadcast_receipts WHERE broadcastId = ? AND agentId = ? AND tenantId = ?', [id, req.auth.sub, tenantId]);
        if (receipts.length === 0)
            return res.status(404).send();
    }
    else if (req.auth.role !== Role.MANAGER && req.auth.role !== Role.ADMIN)
        return res.status(403).send();
        
    res.setHeader('Content-Disposition', `inline; filename="${(message.attachmentName ?? 'attachment').replaceAll('"', '')}"`);
    res.type(message.attachmentMime ?? 'application/octet-stream');
    return redirectToSignedObject(res, attachmentPath(message));
});
