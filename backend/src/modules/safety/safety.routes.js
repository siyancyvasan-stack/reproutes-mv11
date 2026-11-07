import { Role } from '../../lib/enums.js';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { redirectToSignedObject, uploadObject } from '../files/object-storage.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import db from '../../lib/db.js';
import { sendEmergencySms } from '../../lib/sms.js';
import { auditSafetyAction, severityFor, upsertOpenSafetyAlert } from './safety.service.js';
import { randomUUID } from 'node:crypto';

export const safetyRouter = Router();
safetyRouter.use(authenticate);

const photos = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3 },
    fileFilter: (_req, file, callback) => callback(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

const location = z.object({
    latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(1000).optional(), battery: z.number().int().min(0).max(100).optional(),
    description: z.string().trim().max(2000).optional(),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const noteSchema = z.object({ note: z.string().trim().min(3).max(1000) });
const bulkReasonSchema = reasonSchema.extend({ ids: z.array(z.string().min(1)).min(1).max(100) });
const bulkNoteSchema = noteSchema.extend({ ids: z.array(z.string().min(1)).min(1).max(100) });
const contactSchema = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30), relationship: z.string().trim().max(100).optional(), priority: z.number().int().min(1).max(20).default(1) });

const createEvent = async (req, type, input, photoKeys = []) => {
    let event;
    const photoKeysJson = JSON.stringify(photoKeys);
    
    if (type === 'CHECK_IN') {
        const id = randomUUID();
        await db.query(
            'INSERT INTO SafetyEvent (id, tenantId, agentId, type, severity, status, resolvedAt, resolutionNote, latitude, longitude, accuracy, battery, description, photoKeys) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)',
            [id, req.auth.tenantId, req.auth.sub, type, severityFor(type), 'RESOLVED', 'Agent completed a safety check-in', input.latitude, input.longitude, input.accuracy, input.battery, input.description, photoKeysJson]
        );
        const [events] = await db.query('SELECT * FROM SafetyEvent WHERE id = ?', [id]);
        event = events[0];
    } else {
        event = await upsertOpenSafetyAlert({ tenantId: req.auth.tenantId, agentId: req.auth.sub, type, ...input, lastGpsAt: input.latitude == null ? undefined : new Date() }, req.app.get('io'));
    }
    
    if (photoKeys.length && type !== 'CHECK_IN') {
        await db.query('UPDATE SafetyEvent SET photoKeys = ? WHERE id = ?', [photoKeysJson, event.id]);
        event.photoKeys = photoKeysJson;
    }
    
    const [agents] = await db.query('SELECT name, phone, employeeCode FROM User WHERE id = ?', [req.auth.sub]);
    const agent = agents[0];
    
    const parsedPhotoKeys = typeof event.photoKeys === 'string' ? JSON.parse(event.photoKeys) : (event.photoKeys ?? []);
    const payload = { ...event, photoKeys: parsedPhotoKeys, agent };
    
    if (type === 'SOS' || type === 'INCIDENT') {
        const [recipients] = await db.query(
            'SELECT id, phone FROM User WHERE tenantId = ? AND status = ? AND role IN (?, ?, ?)',
            [req.auth.tenantId, 'ACTIVE', Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER]
        );
        
        const locationText = input.latitude == null || input.longitude == null ? 'Location unavailable' : `Location: https://maps.google.com/?q=${input.latitude},${input.longitude}`;
        const title = `EMERGENCY ${type}: ${agent?.name ?? 'Sales Agent'}`;
        const message = `${input.description || 'Immediate attention required'}. ${locationText}`;
        
        const notificationValues = recipients.map(r => [randomUUID(), req.auth.tenantId, r.id, `SAFETY_${type}`, title, message]);
        
        if (notificationValues.length > 0) {
            await db.query(
                'INSERT INTO Notification (id, tenantId, userId, type, title, message) VALUES ?',
                [notificationValues]
            );
        }
        
        const io = req.app.get('io');
        [Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER].forEach((role) => io?.to(`tenant:${req.auth.tenantId}:role:${role}`).emit('safety:alert', payload));
        
        const [notifications] = await db.query(
            'SELECT * FROM Notification WHERE tenantId = ? AND type = ? ORDER BY createdAt DESC LIMIT ?',
            [req.auth.tenantId, `SAFETY_${type}`, recipients.length]
        );
        
        recipients.forEach((recipient, index) => {
            const notif = notifications.find(n => n.userId === recipient.id);
            if (notif) io?.to(`user:${recipient.id}`).emit('notification:created', notif);
        });
        
        void sendEmergencySms(recipients.filter((recipient) => Boolean(recipient.phone)).map((recipient) => ({ userId: recipient.id, phone: recipient.phone })), `${title}. ${message}`, event.id);
    }
    return payload;
};

safetyRouter.get('/events', async (req, res) => {
    const query = z.object({ filter: z.enum(['ALL', 'CRITICAL', 'OFFLINE', 'STATIONARY', 'SOS', 'RESOLVED', 'ARCHIVED']).default('ALL'), search: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    
    let agentIds = undefined;
    if (query.search) {
        const [searchUsers] = await db.query(
            'SELECT id FROM User WHERE tenantId = ? AND role = ? AND (name LIKE ? OR phone LIKE ? OR employeeCode LIKE ?)',
            [req.auth.tenantId, Role.AGENT, `%${query.search}%`, `%${query.search}%`, `%${query.search}%`]
        );
        agentIds = searchUsers.map(u => u.id);
    }

    let whereClause = 'tenantId = ? AND deletedAt IS NULL';
    const params = [req.auth.tenantId];

    if (req.auth.role === Role.AGENT) {
        whereClause += ' AND agentId = ?';
        params.push(req.auth.sub);
    } else if (agentIds !== undefined) {
        if (agentIds.length === 0) {
            return res.json({ items: [], total: 0, page: query.page, limit: query.limit });
        }
        whereClause += ' AND agentId IN (?)';
        params.push(agentIds);
    }

    if (query.filter === 'ARCHIVED') {
        whereClause += ' AND archivedAt IS NOT NULL';
    } else {
        whereClause += ' AND archivedAt IS NULL';
    }

    if (query.filter === 'CRITICAL') {
        whereClause += ' AND severity = ? AND status = ?';
        params.push('CRITICAL', 'OPEN');
    } else if (query.filter === 'OFFLINE') {
        whereClause += ' AND type = ? AND status = ?';
        params.push('OFFLINE', 'OPEN');
    } else if (query.filter === 'STATIONARY') {
        whereClause += ' AND type = ? AND status = ?';
        params.push('STATIONARY', 'OPEN');
    } else if (query.filter === 'SOS') {
        whereClause += ' AND type = ? AND status = ?';
        params.push('SOS', 'OPEN');
    } else if (query.filter === 'RESOLVED') {
        whereClause += ' AND status = ?';
        params.push('RESOLVED');
    }

    const limit = query.limit;
    const offset = (query.page - 1) * limit;

    const [events] = await db.query(`SELECT * FROM SafetyEvent WHERE ${whereClause} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM SafetyEvent WHERE ${whereClause}`, params);
    const total = countResult[0].total;

    const uniqueAgentIds = [...new Set(events.map(e => e.agentId))];
    let agents = [];
    if (uniqueAgentIds.length > 0) {
        const placeholders = uniqueAgentIds.map(() => '?').join(',');
        const [agentRows] = await db.query(
            `SELECT u.id, u.name, u.phone, u.employeeCode, p.status, p.trackingState FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id IN (${placeholders})`,
            uniqueAgentIds
        );
        agents = agentRows;
    }
    
    const byId = new Map(agents.map(a => [a.id, a]));
    
    res.json({ 
        items: events.map((event) => { 
            const agent = byId.get(event.agentId); 
            const parsedPhotoKeys = typeof event.photoKeys === 'string' ? JSON.parse(event.photoKeys) : (event.photoKeys ?? []);
            return { 
                ...event, 
                photoKeys: parsedPhotoKeys,
                agent: agent ? { name: agent.name, phone: agent.phone, employeeCode: agent.employeeCode, status: agent.status ?? 'OFFLINE', trackingState: agent.trackingState } : undefined 
            }; 
        }), 
        total, page: query.page, limit: query.limit 
    });
});

safetyRouter.get('/events/:id/details', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const [events] = await db.query('SELECT * FROM SafetyEvent WHERE id = ? AND tenantId = ? AND deletedAt IS NULL', [String(req.params.id), req.auth.tenantId]);
    const event = events[0];
    if (!event)
        throw new AppError(404, 'SAFETY_ALERT_NOT_FOUND', 'Safety alert was not found');
        
    const [[agents], [attendances], [visits], [history], [auditLogs]] = await Promise.all([
        db.query('SELECT u.id, u.name, u.phone, u.employeeCode, p.* FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id = ? AND u.tenantId = ?', [event.agentId, req.auth.tenantId]),
        db.query('SELECT * FROM Attendance WHERE tenantId = ? AND agentId = ? ORDER BY checkInAt DESC LIMIT 1', [req.auth.tenantId, event.agentId]),
        db.query('SELECT v.*, s.id as s_id, s.name as s_name, s.address as s_address FROM ShopVisit v JOIN Shop s ON v.shopId = s.id WHERE v.tenantId = ? AND v.agentId = ? ORDER BY v.visitedAt DESC LIMIT 1', [req.auth.tenantId, event.agentId]),
        db.query('SELECT * FROM SafetyEvent WHERE tenantId = ? AND agentId = ? AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 30', [req.auth.tenantId, event.agentId]),
        db.query('SELECT a.*, u.name as actorName FROM AuditLog a LEFT JOIN User u ON a.actorId = u.id WHERE a.tenantId = ? AND a.entity = ? AND a.entityId = ? ORDER BY a.createdAt DESC LIMIT 30', [req.auth.tenantId, 'SafetyEvent', event.id]),
    ]);
    
    const agentData = agents[0];
    let agent = undefined;
    if (agentData) {
        agent = {
            id: agentData.id, name: agentData.name, phone: agentData.phone, employeeCode: agentData.employeeCode,
            profile: { status: agentData.status, trackingState: agentData.trackingState, lastLocationAt: agentData.lastLocationAt, latitude: agentData.latitude, longitude: agentData.longitude, batteryLevel: agentData.batteryLevel }
        };
    }
    
    let lastVisit = undefined;
    if (visits[0]) {
        lastVisit = { ...visits[0], shop: { id: visits[0].s_id, name: visits[0].s_name, address: visits[0].s_address } };
    }
    
    event.photoKeys = typeof event.photoKeys === 'string' ? JSON.parse(event.photoKeys) : (event.photoKeys ?? []);
    const parsedHistory = history.map(h => ({...h, photoKeys: typeof h.photoKeys === 'string' ? JSON.parse(h.photoKeys) : (h.photoKeys ?? [])}));
    
    res.json({ 
        event, 
        agent, 
        attendance: attendances[0], 
        lastVisit, 
        history: parsedHistory, 
        audit: auditLogs.map((row) => ({ ...row, id: row.id.toString(), actor: row.actorName ? { name: row.actorName } : null })) 
    });
});

safetyRouter.post('/sos', authorize(Role.AGENT), async (req, res) => res.status(201).json(await createEvent(req, 'SOS', location.parse(req.body))));
safetyRouter.post('/check-in', authorize(Role.AGENT), async (req, res) => res.status(201).json(await createEvent(req, 'CHECK_IN', location.parse(req.body))));

safetyRouter.post('/incidents', authorize(Role.AGENT), photos.array('photos', 3), async (req, res) => {
    const input = location.parse({ latitude: req.body.latitude ? Number(req.body.latitude) : undefined, longitude: req.body.longitude ? Number(req.body.longitude) : undefined, accuracy: req.body.accuracy ? Number(req.body.accuracy) : undefined, battery: req.body.battery ? Number(req.body.battery) : undefined, description: req.body.description });
    const photoKeys = [];
    for (const file of req.files ?? []) {
        photoKeys.push((await uploadObject({ tenantId: req.auth.tenantId, folder: 'safety', originalName: file.originalname, mimeType: file.mimetype, buffer: file.buffer })).storageKey);
    }
    res.status(201).json(await createEvent(req, 'INCIDENT', input, photoKeys));
});

const mutateEvents = async (req, ids, action, reason) => {
    if (ids.length === 0) return 0;
    
    const placeholders = ids.map(() => '?').join(',');
    const [events] = await db.query(
        `SELECT id FROM SafetyEvent WHERE id IN (${placeholders}) AND tenantId = ? AND deletedAt IS NULL`,
        [...ids, req.auth.tenantId]
    );
    
    if (events.length !== new Set(ids).size)
        throw new AppError(404, 'SAFETY_ALERT_NOT_FOUND', 'One or more safety alerts were not found');
        
    const now = new Date();
    
    let sqlUpdate = '';
    let paramsUpdate = [];
    if (action === 'RESOLVE') {
        sqlUpdate = 'UPDATE SafetyEvent SET status = ?, resolvedBy = ?, resolvedAt = ?, resolutionNote = ?';
        paramsUpdate = ['RESOLVED', req.auth.sub, now, reason];
    } else if (action === 'ARCHIVE') {
        sqlUpdate = 'UPDATE SafetyEvent SET status = ?, archivedBy = ?, archivedAt = ?, archiveReason = ?';
        paramsUpdate = ['ARCHIVED', req.auth.sub, now, reason];
    } else {
        sqlUpdate = 'UPDATE SafetyEvent SET status = ?, deletedBy = ?, deletedAt = ?, deleteReason = ?';
        paramsUpdate = ['DELETED', req.auth.sub, now, reason];
    }
    
    sqlUpdate += ` WHERE id IN (${placeholders})`;
    paramsUpdate.push(...events.map(e => e.id));
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(sqlUpdate, paramsUpdate);
        
        const auditValues = events.map(({id}) => [randomUUID(), req.auth.tenantId, req.auth.sub, `SAFETY_ALERT_${action}D`, 'SafetyEvent', id, JSON.stringify({ reason }), req.ip]);
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, ipAddress) VALUES ?',
            [auditValues]
        );
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('safety:resolved', { ids: events.map(({ id }) => id), action });
    return events.length;
};

safetyRouter.patch('/events/bulk/resolve', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { const { ids, note } = bulkNoteSchema.parse(req.body); res.json({ updated: await mutateEvents(req, ids, 'RESOLVE', note) }); });
safetyRouter.patch('/events/bulk/archive', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { const { ids, reason } = bulkReasonSchema.parse(req.body); res.json({ updated: await mutateEvents(req, ids, 'ARCHIVE', reason) }); });
safetyRouter.patch('/events/:id/resolve', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { const { note } = noteSchema.parse(req.body); await mutateEvents(req, [String(req.params.id)], 'RESOLVE', note); res.status(204).end(); });
safetyRouter.patch('/events/:id/archive', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { const { reason } = reasonSchema.parse(req.body); await mutateEvents(req, [String(req.params.id)], 'ARCHIVE', reason); res.status(204).end(); });

safetyRouter.delete('/events/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const { reason } = reasonSchema.parse(req.body);
    const id = String(req.params.id);
    if (req.query.permanent === 'true') {
        if (req.auth.role !== Role.ADMIN)
            throw new AppError(403, 'ADMIN_REQUIRED', 'Only administrators can permanently delete safety alerts');
        const [events] = await db.query('SELECT id FROM SafetyEvent WHERE id = ? AND tenantId = ?', [id, req.auth.tenantId]);
        if (events.length === 0)
            throw new AppError(404, 'SAFETY_ALERT_NOT_FOUND', 'Safety alert was not found');
            
        await auditSafetyAction(req.auth.tenantId, req.auth.sub, 'SAFETY_ALERT_PERMANENTLY_DELETED', id, reason, req.ip);
        await db.query('DELETE FROM SafetyEvent WHERE id = ?', [id]);
    }
    else
        await mutateEvents(req, [id], 'DELETE', reason);
    res.status(204).end();
});

safetyRouter.get('/events/:id/photos/:index', async (req, res) => { 
    const [events] = await db.query('SELECT * FROM SafetyEvent WHERE id = ? AND tenantId = ? AND deletedAt IS NULL', [String(req.params.id), req.auth.tenantId]);
    const event = events[0];
    
    if (!event || (req.auth.role === Role.AGENT && event.agentId !== req.auth.sub))
        throw new AppError(404, 'SAFETY_PHOTO_NOT_FOUND', 'Safety photo was not found'); 
        
    const parsedPhotoKeys = typeof event.photoKeys === 'string' ? JSON.parse(event.photoKeys) : (event.photoKeys ?? []);
    const key = parsedPhotoKeys[Number(req.params.index)]; 
    if (!key)
        throw new AppError(404, 'SAFETY_PHOTO_NOT_FOUND', 'Safety photo was not found'); 
    return redirectToSignedObject(res, key); 
});

safetyRouter.get('/contacts', async (req, res) => {
    const [contacts] = await db.query('SELECT * FROM EmergencyContact WHERE tenantId = ? AND active = ? ORDER BY priority ASC, name ASC', [req.auth.tenantId, true]);
    res.json(contacts);
});

safetyRouter.post('/contacts', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { 
    const input = contactSchema.parse(req.body); 
    const id = randomUUID();
    await db.query(
        'INSERT INTO EmergencyContact (id, tenantId, name, phone, relationship, priority) VALUES (?, ?, ?, ?, ?, ?)',
        [id, req.auth.tenantId, input.name, input.phone, input.relationship ?? null, input.priority]
    );
    const [contacts] = await db.query('SELECT * FROM EmergencyContact WHERE id = ?', [id]);
    res.status(201).json(contacts[0]); 
});

safetyRouter.patch('/contacts/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { 
    const input = contactSchema.parse(req.body); 
    const id = String(req.params.id);
    const [updateResult] = await db.query(
        'UPDATE EmergencyContact SET name = ?, phone = ?, relationship = ?, priority = ? WHERE id = ? AND tenantId = ? AND active = ?',
        [input.name, input.phone, input.relationship ?? null, input.priority, id, req.auth.tenantId, true]
    );
    if (updateResult.affectedRows === 0)
        throw new AppError(404, 'EMERGENCY_CONTACT_NOT_FOUND', 'Emergency contact was not found'); 
    const [contacts] = await db.query('SELECT * FROM EmergencyContact WHERE id = ?', [id]);
    res.json(contacts[0]); 
});

safetyRouter.delete('/contacts/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { 
    const id = String(req.params.id); 
    if (req.query.permanent === 'true') {
        if (req.auth.role !== Role.ADMIN)
            throw new AppError(403, 'ADMIN_REQUIRED', 'Only administrators can permanently delete emergency contacts');
        const [deleteResult] = await db.query('DELETE FROM EmergencyContact WHERE id = ? AND tenantId = ?', [id, req.auth.tenantId]);
        if (deleteResult.affectedRows === 0)
            throw new AppError(404, 'EMERGENCY_CONTACT_NOT_FOUND', 'Emergency contact was not found');
    }
    else {
        const [updateResult] = await db.query('UPDATE EmergencyContact SET active = ? WHERE id = ? AND tenantId = ? AND active = ?', [false, id, req.auth.tenantId, true]);
        if (updateResult.affectedRows === 0)
            throw new AppError(404, 'EMERGENCY_CONTACT_NOT_FOUND', 'Emergency contact was not found');
    } 
    res.status(204).end(); 
});

safetyRouter.get('/audit', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => { 
    const [rows] = await db.query(
        'SELECT a.*, u.name as actorName, u.email as actorEmail FROM AuditLog a LEFT JOIN User u ON a.actorId = u.id WHERE a.tenantId = ? AND a.entity = ? ORDER BY a.createdAt DESC LIMIT 200',
        [req.auth.tenantId, 'SafetyEvent']
    );
    res.json(rows.map((row) => ({ ...row, id: row.id.toString(), actor: row.actorName ? { name: row.actorName, email: row.actorEmail } : null }))); 
});
