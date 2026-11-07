import { ContactAssignmentType, Role, UserStatus } from '../../lib/enums.js';
import { Router } from 'express';
import { distributedRateLimit } from '../../middleware/distributedRateLimit.js';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { normalizeInternationalNumber } from './phone.js';
import { getPresentUsers } from '../tracking/presence.service.js';
import { randomUUID } from 'node:crypto';

export const contactRouter = Router();
const DEFAULT_SUPPORT_WHATSAPP_NUMBER = '94729790397';
contactRouter.use(authenticate);
contactRouter.use(distributedRateLimit('contacts', {
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.auth.tenantId}:${req.auth.sub}`,
}));

const serialize = (user, presentUsers) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    whatsappNumber: user.whatsappNumber,
    availability: user.status === UserStatus.ACTIVE ? 'AVAILABLE' : 'INACTIVE',
    presence: user.role === Role.AGENT
        ? (presentUsers.has(user.id) ? 'ONLINE' : user.agentProfile_status ?? 'OFFLINE')
        : undefined,
});

contactRouter.get('/whatsapp-destination', authorize(Role.AGENT), async (req, res) => {
    const [settingsRows] = await db.query('SELECT supportWhatsappNumber FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ whatsappNumber: settingsRows[0]?.supportWhatsappNumber || DEFAULT_SUPPORT_WHATSAPP_NUMBER });
});

contactRouter.get('/', async (req, res) => {
    const [assignments] = await db.query(
        `SELECT c.*, 
                uA.id as uA_id, uA.name as uA_name, uA.role as uA_role, uA.avatarUrl as uA_avatarUrl, uA.phone as uA_phone, uA.whatsappNumber as uA_whatsappNumber, uA.status as uA_status, pA.status as pA_status, pA.lastHeartbeatAt as pA_lastHeartbeatAt, pA.lastSeenAt as pA_lastSeenAt,
                uB.id as uB_id, uB.name as uB_name, uB.role as uB_role, uB.avatarUrl as uB_avatarUrl, uB.phone as uB_phone, uB.whatsappNumber as uB_whatsappNumber, uB.status as uB_status, pB.status as pB_status, pB.lastHeartbeatAt as pB_lastHeartbeatAt, pB.lastSeenAt as pB_lastSeenAt
         FROM ContactAssignment c 
         JOIN User uA ON c.userAId = uA.id 
         LEFT JOIN AgentProfile pA ON uA.id = pA.userId
         JOIN User uB ON c.userBId = uB.id 
         LEFT JOIN AgentProfile pB ON uB.id = pB.userId
         WHERE c.tenantId = ? AND (c.userAId = ? OR c.userBId = ?) ORDER BY c.createdAt ASC`,
        [req.auth.tenantId, req.auth.sub, req.auth.sub]
    );

    const candidates = [];
    const contactsMap = assignments.flatMap((a) => {
        const isUserA = a.userAId === req.auth.sub;
        
        const contact = isUserA ? {
            id: a.uB_id, name: a.uB_name, role: a.uB_role, avatarUrl: a.uB_avatarUrl, phone: a.uB_phone, whatsappNumber: a.uB_whatsappNumber, status: a.uB_status, agentProfile_status: a.pB_status, agentProfile_lastHeartbeatAt: a.pB_lastHeartbeatAt, agentProfile_lastSeenAt: a.pB_lastSeenAt
        } : {
            id: a.uA_id, name: a.uA_name, role: a.uA_role, avatarUrl: a.uA_avatarUrl, phone: a.uA_phone, whatsappNumber: a.uA_whatsappNumber, status: a.uA_status, agentProfile_status: a.pA_status, agentProfile_lastHeartbeatAt: a.pA_lastHeartbeatAt, agentProfile_lastSeenAt: a.pA_lastSeenAt
        };
        
        candidates.push(contact);
        
        return contact.status === UserStatus.ACTIVE ? [{ contact, assignmentType: a.type }] : [];
    });

    const presentUsers = await getPresentUsers(req.auth.tenantId, candidates.filter((user) => user.role === Role.AGENT).map((user) => user.id));
    
    const contacts = contactsMap.map(c => ({ ...serialize(c.contact, presentUsers), assignmentType: c.assignmentType }));

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ contacts });
});

const expectedRoles = {
    SALES_MANAGER: [Role.AGENT, Role.MANAGER],
    SALES_FACTORY_MANAGER: [Role.AGENT, Role.FACTORY_MANAGER],
    MANAGER_FACTORY_MANAGER: [Role.MANAGER, Role.FACTORY_MANAGER],
};

const assignmentInput = z.object({ userAId: z.string().min(1), userBId: z.string().min(1), type: z.nativeEnum(ContactAssignmentType) });

contactRouter.get('/admin', authorize(Role.ADMIN), async (req, res) => {
    const rolesStr = [Role.AGENT, Role.MANAGER, Role.FACTORY_MANAGER].map(() => '?').join(',');
    
    const [[users], [assignments], [settingsRows]] = await Promise.all([
        db.query(
            `SELECT u.id, u.name, u.role, u.avatarUrl, u.phone, u.whatsappNumber, u.status, p.status as agentProfile_status, p.lastHeartbeatAt as agentProfile_lastHeartbeatAt, p.lastSeenAt as agentProfile_lastSeenAt
             FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId 
             WHERE u.tenantId = ? AND u.role IN (${rolesStr}) ORDER BY u.role ASC, u.name ASC`,
            [req.auth.tenantId, Role.AGENT, Role.MANAGER, Role.FACTORY_MANAGER]
        ),
        db.query('SELECT * FROM ContactAssignment WHERE tenantId = ? ORDER BY createdAt ASC', [req.auth.tenantId]),
        db.query('SELECT phoneCountryCode FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]),
    ]);

    const presentUsers = await getPresentUsers(req.auth.tenantId, users.filter((user) => user.role === Role.AGENT).map((user) => user.id));
    res.json({ users: users.map((user) => serialize(user, presentUsers)), assignments, phoneCountryCode: settingsRows[0]?.phoneCountryCode ?? '94' });
});

contactRouter.put('/admin/users/:id', authorize(Role.ADMIN), async (req, res) => {
    const input = z.object({ phone: z.string().max(30).nullable(), whatsappNumber: z.string().max(30).nullable() }).parse(req.body);
    const [targets] = await db.query('SELECT id FROM User WHERE id = ? AND tenantId = ?', [String(req.params.id), req.auth.tenantId]);
    
    if (targets.length === 0)
        return res.status(404).json({ error: { code: 'USER_NOT_FOUND' } });
        
    const [settings] = await db.query('SELECT phoneCountryCode FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    const whatsappNumber = input.whatsappNumber ? normalizeInternationalNumber(input.whatsappNumber, settings[0]?.phoneCountryCode ?? '94') : null;
    
    if (input.whatsappNumber && !whatsappNumber)
        return res.status(422).json({ error: { code: 'INVALID_WHATSAPP_NUMBER', message: 'Enter a valid international or local phone number.' } });

    const connection = await db.getConnection();
    await connection.beginTransaction();
    let user;
    try {
        await connection.query('UPDATE User SET phone = ?, whatsappNumber = ? WHERE id = ?', [input.phone?.trim() || null, whatsappNumber, targets[0].id]);
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'CONTACT_DETAILS_UPDATED', 'User', targets[0].id, req.ip]
        );
        
        const [users] = await connection.query(
            `SELECT u.id, u.name, u.role, u.avatarUrl, u.phone, u.whatsappNumber, u.status, p.status as agentProfile_status, p.lastHeartbeatAt as agentProfile_lastHeartbeatAt, p.lastSeenAt as agentProfile_lastSeenAt
             FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id = ?`, [targets[0].id]
        );
        user = users[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    res.json(serialize(user, new Set()));
});

contactRouter.put('/admin/country-code', authorize(Role.ADMIN), async (req, res) => {
    const phoneCountryCode = z.object({ phoneCountryCode: z.string().regex(/^\d{1,4}$/) }).parse(req.body).phoneCountryCode;
    
    await db.query(
        'INSERT INTO TenantSettings (tenantId, phoneCountryCode, updatedAt) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE phoneCountryCode = VALUES(phoneCountryCode), updatedAt = VALUES(updatedAt)',
        [req.auth.tenantId, phoneCountryCode]
    );
    
    const [settings] = await db.query('SELECT phoneCountryCode FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    res.json({ phoneCountryCode: settings[0].phoneCountryCode });
});

contactRouter.post('/admin/assignments', authorize(Role.ADMIN), async (req, res) => {
    const input = assignmentInput.parse(req.body);
    if (input.userAId === input.userBId)
        return res.status(422).json({ error: { code: 'INVALID_ASSIGNMENT' } });
        
    const [users] = await db.query('SELECT id, role FROM User WHERE tenantId = ? AND id IN (?, ?)', [req.auth.tenantId, input.userAId, input.userBId]);
    if (users.length !== 2)
        return res.status(404).json({ error: { code: 'USER_NOT_FOUND' } });
        
    const pair = expectedRoles[input.type];
    const a = users.find((user) => user.id === input.userAId);
    const b = users.find((user) => user.id === input.userBId);
    
    if (a.role !== pair[0] || b.role !== pair[1])
        return res.status(422).json({ error: { code: 'ROLE_ASSIGNMENT_MISMATCH' } });
        
    const assignmentId = randomUUID();
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let assignment;
    try {
        await connection.query(
            'INSERT INTO ContactAssignment (id, tenantId, userAId, userBId, type, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
            [assignmentId, req.auth.tenantId, input.userAId, input.userBId, input.type]
        );
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'CONTACT_ASSIGNMENT_CREATED', 'ContactAssignment', assignmentId, req.ip]
        );
        
        const [assignments] = await connection.query('SELECT * FROM ContactAssignment WHERE id = ?', [assignmentId]);
        assignment = assignments[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    res.status(201).json(assignment);
});

contactRouter.delete('/admin/assignments/:id', authorize(Role.ADMIN), async (req, res) => {
    const [assignments] = await db.query('SELECT id FROM ContactAssignment WHERE id = ? AND tenantId = ?', [String(req.params.id), req.auth.tenantId]);
    
    if (assignments.length === 0)
        return res.status(404).json({ error: { code: 'ASSIGNMENT_NOT_FOUND' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('DELETE FROM ContactAssignment WHERE id = ?', [assignments[0].id]);
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'CONTACT_ASSIGNMENT_DELETED', 'ContactAssignment', assignments[0].id, req.ip]
        );
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    res.status(204).end();
});
