import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { hashPassword } from '../../lib/password.js';
import { avatarUpload } from '../../middleware/upload.js';
import { env } from '../../config/env.js';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { buildAgentActivity, parseActivityRange } from './agent-activity.service.js';
import { deleteObject, redirectToSignedObject, uploadObject } from '../files/object-storage.service.js';
import { randomUUID } from 'node:crypto';

export const agentRouter = Router();
agentRouter.use(authenticate);

agentRouter.get('/', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? '');
    
    let whereClause = 'tenantId = ? AND role = ? AND status = ?';
    const params = [req.auth.tenantId, Role.AGENT, 'ACTIVE'];
    
    if (search) {
        whereClause += ' AND (name LIKE ? OR email LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    
    const countQuery = `SELECT COUNT(*) as total FROM User WHERE ${whereClause}`;
    const [countResult] = await db.query(countQuery, params);
    const total = countResult[0].total;
    
    const itemsQuery = `
        SELECT u.id, u.name, u.email, u.employeeCode, u.avatarUrl, u.phone, u.region, u.status, p.id as p_id, p.routeAssigned, p.vehicleNo, p.shiftActive, p.status as p_status 
        FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId 
        WHERE u.tenantId = ? AND u.role = ? AND u.status = ?${search ? ' AND (u.name LIKE ? OR u.email LIKE ?)' : ''}
        ORDER BY u.name ASC LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(itemsQuery, [...params, limit, (page - 1) * limit]);
    
    const [assignments] = await db.query(
        'SELECT userAId, userBId FROM ContactAssignment WHERE tenantId = ? AND (userAId = ? OR userBId = ?)',
        [req.auth.tenantId, req.auth.sub, req.auth.sub]
    );
    
    const authorizedIds = new Set(assignments.flatMap((assignment) => [assignment.userAId, assignment.userBId]));
    
    const items = rows.map(r => {
        const agentProfile = r.p_id ? { id: r.p_id, routeAssigned: r.routeAssigned, vehicleNo: r.vehicleNo, shiftActive: r.shiftActive, status: r.p_status } : null;
        return {
            id: r.id, name: r.name, email: r.email, employeeCode: r.employeeCode, avatarUrl: r.avatarUrl, region: r.region, status: r.status,
            agentProfile,
            phone: req.auth.role === Role.ADMIN || authorizedIds.has(r.id) ? r.phone : null
        };
    });
    
    res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

agentRouter.post('/', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const input = z.object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8).optional(),
        employeeCode: z.string().min(2).optional(),
        phone: z.string().optional(),
        routeAssigned: z.string().optional(),
        vehicleNo: z.string().optional(),
    }).parse(req.body);
    
    const email = input.email.trim().toLowerCase();
    
    const [existingUsers] = await db.query('SELECT id FROM User WHERE tenantId = ? AND email = ? LIMIT 1', [req.auth.tenantId, email]);
    if (existingUsers.length > 0) {
        return res.status(409).json({
            error: { code: 'EMAIL_ALREADY_EXISTS', message: 'This email is already used. Enter a different agent email address.' },
        });
    }
    
    if (input.employeeCode) {
        const [existingCode] = await db.query('SELECT id FROM User WHERE tenantId = ? AND employeeCode = ? LIMIT 1', [req.auth.tenantId, input.employeeCode.trim()]);
        if (existingCode.length > 0) {
            return res.status(409).json({
                error: { code: 'EMPLOYEE_CODE_ALREADY_EXISTS', message: 'This employee code is already assigned to another user.' },
            });
        }
    }
    
    const generatedEmployeeCode = `TF-${Date.now().toString().slice(-6)}`;
    const temporaryPassword = input.password ?? 'Agent@123';
    const passwordHash = await hashPassword(temporaryPassword);
    
    const userId = randomUUID();
    const profileId = randomUUID();
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(
            'INSERT INTO User (id, tenantId, name, email, passwordHash, employeeCode, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, req.auth.tenantId, input.name, email, passwordHash, input.employeeCode ?? generatedEmployeeCode, input.phone ?? null, Role.AGENT]
        );
        await connection.query(
            'INSERT INTO AgentProfile (id, userId, routeAssigned, vehicleNo) VALUES (?, ?, ?, ?)',
            [profileId, userId, input.routeAssigned ?? null, input.vehicleNo ?? null]
        );
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const [createdUsers] = await db.query(
        'SELECT u.*, p.routeAssigned, p.vehicleNo, p.shiftActive, p.status as p_status FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id = ?',
        [userId]
    );
    const r = createdUsers[0];
    const user = {
        ...r,
        agentProfile: { routeAssigned: r.routeAssigned, vehicleNo: r.vehicleNo, shiftActive: r.shiftActive, status: r.p_status },
        routeAssigned: undefined, vehicleNo: undefined, shiftActive: undefined, p_status: undefined
    };
    
    res.status(201).json({
        ...user,
        temporaryPassword: input.password ? undefined : temporaryPassword,
    });
});

agentRouter.patch('/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const input = z.object({
        name: z.string().min(2), email: z.string().email(), employeeCode: z.string().min(2),
        phone: z.string().optional(), routeAssigned: z.string().optional(), vehicleNo: z.string().optional(),
        password: z.string().min(8).optional(),
    }).parse(req.body);
    const agentId = String(req.params.id);
    const email = input.email.trim().toLowerCase();
    const [conflicts] = await db.query('SELECT id FROM User WHERE tenantId = ? AND (email = ? OR employeeCode = ?) AND id <> ? LIMIT 1', [req.auth.tenantId, email, input.employeeCode.trim(), agentId]);
    if (conflicts.length) return res.status(409).json({ error: { code: 'AGENT_DETAILS_ALREADY_EXISTS', message: 'Email or employee code is already used by another agent.' } });
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.query('UPDATE User SET name = ?, email = ?, employeeCode = ?, phone = ? WHERE id = ? AND tenantId = ? AND role = ? AND status = ?', [input.name.trim(), email, input.employeeCode.trim(), input.phone?.trim() || null, agentId, req.auth.tenantId, Role.AGENT, 'ACTIVE']);
        if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Active agent not found.' } }); }
        await connection.query('UPDATE AgentProfile SET routeAssigned = ?, vehicleNo = ? WHERE userId = ?', [input.routeAssigned?.trim() || null, input.vehicleNo?.trim() || null, agentId]);
        if (input.password) await connection.query('UPDATE User SET passwordHash = ? WHERE id = ?', [await hashPassword(input.password), agentId]);
        await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    const [rows] = await db.query('SELECT u.*, p.routeAssigned, p.vehicleNo, p.shiftActive, p.status as p_status FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id = ?', [agentId]);
    return res.json(rows[0]);
});

// Removing an agent from the directory keeps their operational history intact,
// while immediately preventing sign-in and live tracking.
agentRouter.delete('/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const agentId = String(req.params.id);
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const [agents] = await connection.query(
            'SELECT id, name FROM User WHERE id = ? AND tenantId = ? AND role = ? AND status = ? LIMIT 1 FOR UPDATE',
            [agentId, req.auth.tenantId, Role.AGENT, 'ACTIVE']
        );
        const agent = agents[0];
        if (!agent) {
            await connection.rollback();
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Active agent not found' } });
        }

        await connection.query('UPDATE User SET status = ? WHERE id = ?', ['INACTIVE', agentId]);
        await connection.query(
            'UPDATE AgentProfile SET shiftActive = ?, status = ? WHERE userId = ?',
            [false, 'OFFLINE', agentId]
        );
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, ipAddress) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'AGENT_REMOVED', 'User', agentId, JSON.stringify({ name: agent.name }), req.ip]
        );
        await connection.commit();
        return res.status(204).send();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

agentRouter.get('/me/activity', authorize(Role.AGENT), async (req, res) => {
    const [settingsRows] = await db.query('SELECT timezone FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    const settings = settingsRows[0];
    
    let range;
    try {
        range = parseActivityRange(req.query.from, req.query.to, settings?.timezone);
    } catch {
        return res.status(422).json({ error: { code: 'INVALID_ACTIVITY_RANGE', message: 'Use valid YYYY-MM-DD dates within a one-year range.' } });
    }
    return res.json(await buildAgentActivity(req.auth.sub, req.auth, range));
});

agentRouter.get('/me/activity/replay', authorize(Role.AGENT), async (req, res) => {
    const [settingsRows] = await db.query('SELECT timezone FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    const settings = settingsRows[0];
    
    let range;
    try {
        range = parseActivityRange(req.query.date, req.query.date, settings?.timezone);
    } catch {
        return res.status(422).json({ error: { code: 'INVALID_DATE', message: 'Use a valid YYYY-MM-DD date.' } });
    }
    
    const report = await buildAgentActivity(req.auth.sub, req.auth, range);
    if (!report)
        return res.status(404).json({ error: { code: 'ACTIVITY_NOT_FOUND' } });
        
    const resolution = Math.min(2000, Math.max(100, Number(req.query.resolution) || 1000));
    const points = report.route.points;
    if (points.length <= resolution)
        return res.json({ points });
        
    const step = (points.length - 1) / (resolution - 1);
    return res.json({ points: Array.from({ length: resolution }, (_, index) => points[Math.min(points.length - 1, Math.round(index * step))]) });
});

agentRouter.get('/me/activity/visits/:visitId', authorize(Role.AGENT), async (req, res) => {
    const [visits] = await db.query('SELECT * FROM ShopVisit WHERE id = ? AND tenantId = ? AND agentId = ? LIMIT 1', [String(req.params.id || req.params.visitId), req.auth.tenantId, req.auth.sub]);
    const visit = visits[0];
    if (!visit)
        return res.status(404).json({ error: { code: 'VISIT_NOT_FOUND', message: 'Visit not found.' } });
        
    const [[shops], [images], [orders]] = await Promise.all([
        db.query('SELECT * FROM Shop WHERE id = ?', [visit.shopId]),
        db.query('SELECT * FROM ShopVisitImage WHERE shopVisitId = ?', [visit.id]),
        db.query('SELECT * FROM Order WHERE shopVisitId = ?', [visit.id])
    ]);
    
    visit.shop = shops[0] ?? null;
    visit.images = images;
    
    if (orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        const [[items], [invoices]] = await Promise.all([
            db.query(`SELECT i.*, p.name as p_name, p.sku as p_sku FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId IN (${placeholders})`, orderIds),
            db.query(`SELECT * FROM Invoice WHERE orderId IN (${placeholders})`, orderIds)
        ]);
        
        let payments = [];
        if (invoices.length > 0) {
            const invoiceIds = invoices.map(i => i.id);
            const invPlaceholders = invoiceIds.map(() => '?').join(',');
            [payments] = await db.query(`SELECT * FROM Payment WHERE invoiceId IN (${invPlaceholders})`, invoiceIds);
        }
        
        const itemsByOrder = new Map();
        items.forEach(item => {
            if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
            itemsByOrder.get(item.orderId).push({...item, product: { name: item.p_name, sku: item.p_sku }, p_name: undefined, p_sku: undefined});
        });
        
        const invoicesByOrder = new Map();
        const paymentsByInvoice = new Map();
        payments.forEach(p => {
            if (!paymentsByInvoice.has(p.invoiceId)) paymentsByInvoice.set(p.invoiceId, []);
            paymentsByInvoice.get(p.invoiceId).push(p);
        });
        
        invoices.forEach(inv => {
            inv.payments = paymentsByInvoice.get(inv.id) ?? [];
            invoicesByOrder.set(inv.orderId, inv);
        });
        
        visit.orders = orders.map(o => ({...o, items: itemsByOrder.get(o.id) ?? [], invoice: invoicesByOrder.get(o.id) ?? null}));
    } else {
        visit.orders = [];
    }
    
    return res.json(visit);
});

agentRouter.post('/me/activity/corrections', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({ visitId: z.string().optional(), attendanceId: z.string().optional(), requestedCheckOutAt: z.string().datetime().optional(), reason: z.string().trim().min(10).max(1000) }).refine(value => Boolean(value.visitId) !== Boolean(value.attendanceId), { message: 'Choose one visit or attendance record.' }).parse(req.body);
    
    if (input.visitId) {
        const [visits] = await db.query('SELECT id FROM ShopVisit WHERE id = ? AND tenantId = ? AND agentId = ? LIMIT 1', [input.visitId, req.auth.tenantId, req.auth.sub]);
        if (visits.length === 0) return res.status(404).json({ error: { code: 'VISIT_NOT_FOUND' } });
    }
    if (input.attendanceId) {
        const [att] = await db.query('SELECT id FROM Attendance WHERE id = ? AND tenantId = ? AND agentId = ? LIMIT 1', [input.attendanceId, req.auth.tenantId, req.auth.sub]);
        if (att.length === 0) return res.status(404).json({ error: { code: 'ATTENDANCE_NOT_FOUND' } });
    }
    
    const id = randomUUID();
    await db.query(
        'INSERT INTO ActivityCorrectionRequest (id, tenantId, agentId, visitId, attendanceId, requestedCheckOutAt, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, req.auth.tenantId, req.auth.sub, input.visitId ?? null, input.attendanceId ?? null, input.requestedCheckOutAt ? new Date(input.requestedCheckOutAt) : null, input.reason]
    );
    const [created] = await db.query('SELECT * FROM ActivityCorrectionRequest WHERE id = ?', [id]);
    
    return res.status(201).json(created[0]);
});

agentRouter.get('/:id/activity', async (req, res) => {
    if (![Role.ADMIN, Role.MANAGER, Role.AGENT].includes(req.auth.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN' } });
        
    const [settingsRows] = await db.query('SELECT timezone FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    const settings = settingsRows[0];
    let range;
    try {
        range = parseActivityRange(req.query.from, req.query.to, settings?.timezone);
    } catch {
        return res.status(422).json({ error: { code: 'INVALID_ACTIVITY_RANGE', message: 'Use valid YYYY-MM-DD dates within a one-year range.' } });
    }
    
    const report = await buildAgentActivity(String(req.params.id), req.auth, range);
    if (!report)
        return res.status(req.auth.role === Role.AGENT ? 403 : 404).json({ error: { code: 'AGENT_NOT_FOUND' } });
    return res.json(report);
});

agentRouter.get('/:id/activity/export/:format', async (req, res) => {
    if (![Role.ADMIN, Role.MANAGER, Role.AGENT].includes(req.auth.role))
        return res.status(403).json({ error: { code: 'FORBIDDEN' } });
        
    let range;
    try {
        range = parseActivityRange(req.query.from, req.query.to);
    } catch {
        return res.status(422).json({ error: { code: 'INVALID_ACTIVITY_RANGE' } });
    }
    
    const report = await buildAgentActivity(String(req.params.id), req.auth, range);
    if (!report)
        return res.status(req.auth.role === Role.AGENT ? 403 : 404).json({ error: { code: 'AGENT_NOT_FOUND' } });
        
    const format = String(req.params.format).toLowerCase();
    const filename = `agent-activity-${report.agent.employeeCode ?? report.agent.id}-${range.fromKey}-${range.toKey}`;
    
    if (format === 'pdf') {
        res.type('application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
        const doc = new PDFDocument({ margin: 42 });
        doc.pipe(res);
        doc.fontSize(20).text('Reproutes Agent Activity & Performance').fontSize(11).text(`${report.agent.name} · ${report.agent.employeeCode ?? report.agent.id}`).text(`${range.fromKey} to ${range.toKey}`).moveDown();
        const kpi = report.kpis;
        doc.fontSize(13).text('Summary').fontSize(10).text(`Status: ${kpi.currentStatus}   Working: ${Math.floor(kpi.workingMinutes / 60)}h ${kpi.workingMinutes % 60}m   Distance: ${kpi.distanceKm} km`).text(`Shops: ${kpi.shopsVisited}   Orders: ${kpi.orders}   Sales: LKR ${kpi.totalSalesLkr.toLocaleString()}   Collections: LKR ${kpi.paymentCollectionsLkr.toLocaleString()}`).moveDown();
        doc.fontSize(13).text('Activity timeline').fontSize(9);
        report.timeline.forEach((event) => doc.text(`${new Date(event.at).toLocaleString()} — ${event.title}${event.detail ? ` — ${event.detail}` : ''}`));
        doc.moveDown().fontSize(13).text('Shop visits').fontSize(9);
        report.visits.forEach((visit) => doc.text(`${visit.sequence}. ${visit.shopName} — ${visit.durationMinutes} min — Sales LKR ${visit.salesLkr.toLocaleString()} — ${visit.paymentStatus}`));
        doc.end();
        return;
    }
    
    if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Reproutes';
        workbook.created = new Date();
        const summary = workbook.addWorksheet('Summary');
        summary.addRows([['Agent', report.agent.name], ['Employee code', report.agent.employeeCode], ['From', range.fromKey], ['To', range.toKey], ['Working minutes', report.kpis.workingMinutes], ['Shops visited', report.kpis.shopsVisited], ['Orders', report.kpis.orders], ['Sales LKR', report.kpis.totalSalesLkr], ['Collections LKR', report.kpis.paymentCollectionsLkr], ['Distance km', report.kpis.distanceKm]]);
        summary.getColumn(1).font = { bold: true };
        const timeline = workbook.addWorksheet('Timeline');
        timeline.columns = [{ header: 'Time', key: 'at', width: 24 }, { header: 'Event', key: 'title', width: 42 }, { header: 'Detail', key: 'detail', width: 35 }, { header: 'Entity ID', key: 'entityId', width: 28 }];
        timeline.addRows(report.timeline);
        const visits = workbook.addWorksheet('Shop Visits');
        visits.columns = [{ header: '#', key: 'sequence', width: 6 }, { header: 'Shop', key: 'shopName', width: 28 }, { header: 'Arrival', key: 'arrivalAt', width: 24 }, { header: 'Departure', key: 'departureAt', width: 24 }, { header: 'Minutes', key: 'durationMinutes', width: 12 }, { header: 'GPS verified', key: 'gpsVerified', width: 14 }, { header: 'Sales LKR', key: 'salesLkr', width: 16 }, { header: 'Collections LKR', key: 'collectedLkr', width: 18 }, { header: 'Payment', key: 'paymentStatus', width: 16 }, { header: 'Notes', key: 'notes', width: 35 }];
        visits.addRows(report.visits);
        const daily = workbook.addWorksheet('Performance');
        daily.columns = Object.keys(report.performance.daily[0] ?? { date: '' }).map((key) => ({ header: key, key, width: 18 }));
        daily.addRows(report.performance.daily);
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
        return;
    }
    return res.status(422).json({ error: { code: 'INVALID_EXPORT_FORMAT', message: 'Use pdf or xlsx.' } });
});

agentRouter.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (req.auth.role === Role.AGENT && req.auth.sub !== id)
        return res.status(403).json({ error: { code: 'FORBIDDEN' } });
        
    const [agents] = await db.query(
        'SELECT u.id, u.name, u.email, u.employeeCode, u.avatarUrl, u.phone, u.region, u.status, p.id as p_id, p.routeAssigned, p.vehicleNo, p.shiftActive, p.status as p_status FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id = ? AND u.tenantId = ? AND u.role = ? LIMIT 1',
        [id, req.auth.tenantId, Role.AGENT]
    );
    const agentRow = agents[0];
    if (!agentRow)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
        
    let assignment = null;
    if (req.auth.role === Role.ADMIN || req.auth.role === Role.AGENT) {
        assignment = { id: 'self-or-admin' };
    } else {
        const [assignments] = await db.query(
            'SELECT id FROM ContactAssignment WHERE tenantId = ? AND ((userAId = ? AND userBId = ?) OR (userAId = ? AND userBId = ?)) LIMIT 1',
            [req.auth.tenantId, req.auth.sub, id, id, req.auth.sub]
        );
        assignment = assignments[0];
    }
    
    const [attendances] = await db.query('SELECT * FROM Attendance WHERE agentId = ? ORDER BY date DESC LIMIT 10', [id]);
    
    const agent = {
        id: agentRow.id, name: agentRow.name, email: agentRow.email, employeeCode: agentRow.employeeCode, avatarUrl: agentRow.avatarUrl, region: agentRow.region, status: agentRow.status,
        agentProfile: agentRow.p_id ? { id: agentRow.p_id, routeAssigned: agentRow.routeAssigned, vehicleNo: agentRow.vehicleNo, shiftActive: agentRow.shiftActive, status: agentRow.p_status } : null,
        attendance: attendances
    };
    
    return res.json({ ...agent, phone: assignment ? agentRow.phone : null });
});

const findAccessibleAgent = async (id, tenantId) => {
    const [agents] = await db.query('SELECT id, avatarUrl FROM User WHERE id = ? AND tenantId = ? AND role = ? LIMIT 1', [id, tenantId, Role.AGENT]);
    return agents[0];
};

const canManageAvatar = (requesterId, requesterRole, agentId) => requesterId === agentId || requesterRole === Role.ADMIN || requesterRole === Role.MANAGER;

const avatarStorageKey = (avatarUrl) => {
    if (!avatarUrl) return null;
    try {
        const parsed = new URL(avatarUrl, 'http://reproutes.local');
        const file = parsed.searchParams.get('file');
        if (file && file.includes('/')) return file;
        if (avatarUrl.startsWith('/media/')) return avatarUrl.slice('/media/'.length);
    } catch { }
    return null;
};

const currentStorageProvider = () => 'LOCAL';

agentRouter.get('/:id/avatar', async (req, res) => {
    const agentId = String(req.params.id);
    const canView = canManageAvatar(req.auth.sub, req.auth.role, agentId) || req.auth.role === Role.FACTORY_MANAGER;
    if (!canView) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot view another agent profile image' } });
    
    const agent = await findAccessibleAgent(agentId, req.auth.tenantId);
    if (!agent) return res.status(404).json({ error: { code: 'AVATAR_NOT_FOUND', message: 'Profile image not found' } });
    
    const storageKey = avatarStorageKey(agent.avatarUrl ?? null);
    if (!storageKey) return res.status(404).json({ error: { code: 'AVATAR_NOT_FOUND', message: 'Profile image not found' } });
    return redirectToSignedObject(res, storageKey);
});

agentRouter.post('/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
    const agentId = String(req.params.id);
    if (!canManageAvatar(req.auth.sub, req.auth.role, agentId)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot change another agent profile image' } });
    }
    
    const agent = await findAccessibleAgent(agentId, req.auth.tenantId);
    if (!agent) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    if (!req.file) return res.status(422).json({ error: { code: 'IMAGE_REQUIRED', message: 'Choose a JPG, PNG, or WebP image' } });
    
    const avatarBuffer = await sharp(req.file.buffer)
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'attention', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
        
    const { storageKey, sizeBytes } = await uploadObject({
        tenantId: req.auth.tenantId,
        folder: 'avatars',
        originalName: 'avatar.webp',
        mimeType: 'image/webp',
        buffer: avatarBuffer,
        cacheControl: '31536000',
    });
    
    const avatarUrl = `/api/v1/agents/${agentId}/avatar?file=${encodeURIComponent(storageKey)}`;
    const provider = currentStorageProvider();
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(
            'INSERT INTO FileAsset (id, tenantId, uploadedById, originalName, storageKey, storageProvider, mimeType, sizeBytes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, req.file.originalname, storageKey, provider, 'image/webp', sizeBytes]
        );
        await connection.query('UPDATE User SET avatarUrl = ? WHERE id = ?', [avatarUrl, agentId]);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        await deleteObject(storageKey).catch(() => undefined);
        throw error;
    } finally {
        connection.release();
    }
    
    const previousKey = avatarStorageKey(agent.avatarUrl ?? null);
    if (previousKey && previousKey !== storageKey) {
        await db.query('DELETE FROM FileAsset WHERE tenantId = ? AND storageKey = ?', [req.auth.tenantId, previousKey]).catch(() => undefined);
        await deleteObject(previousKey).catch(() => undefined);
    }
    
    return res.status(201).json({ avatarUrl, message: 'Profile image updated successfully' });
});

agentRouter.delete('/:id/avatar', async (req, res) => {
    const agentId = String(req.params.id);
    if (!canManageAvatar(req.auth.sub, req.auth.role, agentId)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot remove another agent profile image' } });
    }
    
    const agent = await findAccessibleAgent(agentId, req.auth.tenantId);
    if (!agent) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    
    const storageKey = avatarStorageKey(agent.avatarUrl ?? null);
    await db.query('UPDATE User SET avatarUrl = NULL WHERE id = ?', [agentId]);
    
    if (storageKey) {
        await db.query('DELETE FROM FileAsset WHERE tenantId = ? AND storageKey = ?', [req.auth.tenantId, storageKey]).catch(() => undefined);
        await deleteObject(storageKey).catch(() => undefined);
    }
    return res.status(204).send();
});

agentRouter.patch('/:id/destination', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const agentId = String(req.params.id);
    const destination = z.object({
        name: z.string().trim().min(1).max(160),
        address: z.string().trim().min(1).max(500),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
    }).parse(req.body);
    
    const [agents] = await db.query('SELECT id FROM User WHERE id = ? AND tenantId = ? AND role = ? LIMIT 1', [agentId, req.auth.tenantId, Role.AGENT]);
    const agent = agents[0];
    if (!agent) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    
    if (destination.latitude === 0 && destination.longitude === 0) {
        return res.status(400).json({ error: { code: 'INVALID_COORDINATES', message: 'Destination coordinates 0,0 are not allowed.' } });
    }
    
    await db.query(
        'UPDATE AgentProfile SET destinationName = ?, destinationAddress = ?, destinationLat = ?, destinationLng = ?, assignedBy = ?, assignedAt = ? WHERE userId = ?',
        [destination.name, destination.address, destination.latitude, destination.longitude, req.auth.sub, new Date(), agent.id]
    );
    const [profiles] = await db.query('SELECT * FROM AgentProfile WHERE userId = ?', [agent.id]);
    const profile = profiles[0];
    
    await db.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, ipAddress) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.auth.tenantId, req.auth.sub, 'AGENT_DESTINATION_ASSIGNED', 'AgentProfile', profile.id, JSON.stringify({ agentId: agent.id, destinationName: destination.name, destinationAddress: destination.address, latitude: destination.latitude, longitude: destination.longitude }), req.ip]
    );
    
    return res.json(profile);
});
