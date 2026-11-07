import { createHash, randomUUID } from 'node:crypto';
import { RetailerDocumentStatus, RetailerDocumentType, RetailerStatus, Role, ShopImageType } from '../../lib/enums.js';
import { Router } from 'express';
import { z } from 'zod';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { imageUpload, upload } from '../../middleware/upload.js';
import { toStoredUpload } from '../files/file.service.js';
import { redirectToSignedObject } from '../files/object-storage.service.js';
import { deletePermanentImage, uploadPermanentImage } from '../files/image-storage.service.js';
import { recordAgentActivity } from '../agents/agent-activity.service.js';

export const shopRouter = Router();
shopRouter.use(authenticate);

const shopInput = z.object({
    name: z.string().trim().min(2),
    ownerName: z.string().trim().min(2),
    phone: z.string().trim().regex(/^\+?[0-9][0-9\s()-]{6,19}$/, 'Invalid mobile number'),
    alternateMobile: z.string().trim().regex(/^\+?[0-9][0-9\s()-]{6,19}$/, 'Invalid alternate mobile number').optional(),
    email: z.string().trim().email('Invalid email address').optional(),
    address: z.string().trim().min(5),
    city: z.string().trim().min(2),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    allowedVisitRadiusMeters: z.coerce.number().int().min(25).max(500).optional(),
    routeGroup: z.string().trim().optional(),
    outstandingBalanceLkr: z.coerce.number().nonnegative().default(0),
    preferredProducts: z.array(z.string()).default([]),
    requiredProducts: z.array(z.string()).default([]),
    notes: z.string().max(2000).optional(),
    paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT']).default('CASH'),
    paymentTerms: z.string().trim().max(120).optional(),
    creditLimitLkr: z.coerce.number().nonnegative().default(0),
    active: z.boolean().default(true),
    nicNumber: z.string().trim().min(5).max(30).optional(),
    brNumber: z.string().trim().max(60).optional(), whatsappNumber: z.string().trim().max(30).optional(),
    district: z.string().trim().max(80).optional(), country: z.string().trim().default('Sri Lanka'), territory: z.string().trim().max(100).optional(),
    assignedSalespersonId: z.string().optional(), shopCategory: z.string().trim().max(100).optional(),
    retailerType: z.enum(['Grocery', 'Supermarket', 'Mini Mart', 'Restaurant', 'Hotel', 'Pharmacy', 'Wholesale', 'Other']).optional(),
    gpsAccuracy: z.coerce.number().positive().optional(), gpsCapturedAt: z.coerce.date().optional(),
    productCategories: z.array(z.string()).default([]), expectedMonthlyPurchase: z.coerce.number().nonnegative().default(0),
    currentSupplier: z.string().max(200).optional(), deliveryPreference: z.string().max(200).optional(), preferredVisitDays: z.array(z.string()).default([]),
    shopRequirements: z.string().max(2000).optional(), salesNotes: z.string().max(2000).optional(),
});

const auditRetailer = async (tenantId, actorId, action, shopId, metadata, connection = db) => {
    await connection.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [tenantId, actorId, action, 'Retailer', shopId, metadata ? JSON.stringify(metadata) : null]
    );
};

const haversine = (aLat, aLng, bLat, bLng) => { const r = 6371000; const rad = (v) => v * Math.PI / 180; const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2; return 2 * r * Math.asin(Math.sqrt(x)); };
const salesVisibilityRoles = [Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER];

const notifySalesVisibility = async (req, type, title, message, event, payload, connection = db, emit = true) => {
    const [recipients] = await connection.query(
        'SELECT id FROM User WHERE tenantId = ? AND role IN (?, ?, ?) AND status = ?',
        [req.auth.tenantId, Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER, 'ACTIVE']
    );
    if (recipients.length) {
        const placeholders = recipients.map(() => '(UUID(), ?, ?, ?, ?, ?)').join(',');
        const values = recipients.flatMap(r => [req.auth.tenantId, r.id, type, title, message]);
        await connection.query(`INSERT INTO Notification (id, tenantId, userId, type, title, message) VALUES ${placeholders}`, values);
    }
    if (emit) req.app.get('io')?.to(`tenant:${req.auth.tenantId}:role:${Role.ADMIN}`).to(`tenant:${req.auth.tenantId}:role:${Role.MANAGER}`).to(`tenant:${req.auth.tenantId}:role:${Role.FACTORY_MANAGER}`).emit(event, payload);
};

const createFileAsset = async (tenantId, uploadedById, stored, tx) => {
    const id = randomUUID();
    const query = 'INSERT INTO FileAsset (id, tenantId, uploadedById, originalName, storageKey, storageProvider, publicUrl, mimeType, sizeBytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const params = [id, tenantId, uploadedById, stored.originalName, stored.storageKey, 'LOCAL', stored.publicUrl, stored.mimeType, stored.sizeBytes];
    if (tx) {
        await tx.query(query, params);
    } else {
        await db.query(query, params);
    }
    return { id };
};

shopRouter.get('/', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? '').trim();
    const status = z.nativeEnum(RetailerStatus).safeParse(req.query.status);
    const salespersonId = String(req.query.salespersonId ?? '').trim();
    const territory = String(req.query.territory ?? '').trim();
    
    let whereClause = 'tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (search) {
        whereClause += ' AND (name LIKE ? OR ownerName LIKE ? OR city LIKE ? OR retailerCode LIKE ? OR nicNumber LIKE ? OR brNumber LIKE ? OR phone LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }
    if (status.success) {
        whereClause += ' AND status = ?';
        params.push(status.data);
    }
    if (salespersonId) {
        whereClause += ' AND assignedSalespersonId = ?';
        params.push(salespersonId);
    }
    if (territory) {
        whereClause += ' AND territory = ?';
        params.push(territory);
    }
    if (req.auth.role === Role.AGENT) {
        whereClause += ' AND assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    
    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM Shop WHERE ${whereClause}`, params);
    const total = countResult[0].total;
    
    const [shops] = await db.query(
        `SELECT s.*, u.id as u_id, u.name as u_name 
         FROM Shop s LEFT JOIN User u ON s.assignedSalespersonId = u.id 
         WHERE s.${whereClause} ORDER BY s.createdAt DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
    );
    
    let items = shops.map(s => {
        const item = { ...s, assignedSalesperson: s.u_id ? { id: s.u_id, name: s.u_name } : null };
        delete item.u_id; delete item.u_name;
        item._count = { orders: 0, visits: 0 };
        item.documents = [];
        item.images = [];
        return item;
    });
    
    if (items.length > 0) {
        const shopIds = items.map(i => i.id);
        const placeholders = shopIds.map(() => '?').join(',');
        
        const [[ordersCount], [visitsCount], [documents], [images]] = await Promise.all([
            db.query(`SELECT shopId, COUNT(*) as c FROM \`Order\` WHERE shopId IN (${placeholders}) GROUP BY shopId`, shopIds),
            db.query(`SELECT shopId, COUNT(*) as c FROM ShopVisit WHERE shopId IN (${placeholders}) GROUP BY shopId`, shopIds),
            db.query(`SELECT shopId, type, status FROM ShopDocument WHERE shopId IN (${placeholders})`, shopIds),
            db.query(`SELECT * FROM ShopImage WHERE shopId IN (${placeholders}) ORDER BY isPrimary DESC, displayOrder ASC`, shopIds)
        ]);
        
        const oCounts = new Map(ordersCount.map(r => [r.shopId, r.c]));
        const vCounts = new Map(visitsCount.map(r => [r.shopId, r.c]));
        
        const docsMap = new Map();
        documents.forEach(d => {
            if (!docsMap.has(d.shopId)) docsMap.set(d.shopId, []);
            docsMap.get(d.shopId).push({ type: d.type, status: d.status });
        });
        
        const imgsMap = new Map();
        images.forEach(i => {
            if (!imgsMap.has(i.shopId)) imgsMap.set(i.shopId, []);
            imgsMap.get(i.shopId).push(i);
        });
        
        items.forEach(item => {
            item._count.orders = oCounts.get(item.id) ?? 0;
            item._count.visits = vCounts.get(item.id) ?? 0;
            item.documents = docsMap.get(item.id) ?? [];
            item.images = imgsMap.get(item.id) ?? [];
        });
    }
    
    res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

shopRouter.post('/', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => {
    const input = shopInput.parse(req.body);
    
    let dupQuery = 'SELECT id, name, nicNumber, brNumber, phone FROM Shop WHERE tenantId = ? AND (';
    let dupConditions = [];
    let dupParams = [req.auth.tenantId];
    
    if (input.nicNumber) { dupConditions.push('nicNumber = ?'); dupParams.push(input.nicNumber); }
    if (input.brNumber) { dupConditions.push('brNumber = ?'); dupParams.push(input.brNumber); }
    dupConditions.push('phone = ?'); dupParams.push(input.phone);
    if (input.alternateMobile) {
        dupConditions.push('phone = ?'); dupParams.push(input.alternateMobile);
        dupConditions.push('alternateMobile = ?'); dupParams.push(input.alternateMobile);
        dupConditions.push('alternateMobile = ?'); dupParams.push(input.phone);
    } else {
        dupConditions.push('alternateMobile = ?'); dupParams.push(input.phone);
    }
    dupConditions.push('(name = ? AND city = ?)'); dupParams.push(input.name, input.city);
    
    dupQuery += dupConditions.join(' OR ') + ') LIMIT 1';
    
    const [duplicates] = await db.query(dupQuery, dupParams);
    const duplicate = duplicates[0];
    
    if (duplicate) {
        res.status(409).json({ error: { code: 'DUPLICATE_RETAILER', details: { id: duplicate.id, name: duplicate.name, matchingNic: duplicate.nicNumber === input.nicNumber, matchingBr: Boolean(input.brNumber && duplicate.brNumber === input.brNumber), matchingPhone: duplicate.phone === input.phone } } });
        return;
    }
    
    if (input.assignedSalespersonId) {
        const [agents] = await db.query('SELECT id FROM User WHERE id = ? AND tenantId = ? AND role = ? LIMIT 1', [input.assignedSalespersonId, req.auth.tenantId, Role.AGENT]);
        if (agents.length === 0) {
            res.status(422).json({ error: { code: 'INVALID_SALESPERSON' } });
            return;
        }
    }
    
    const shopId = randomUUID();
    const assignedSalespersonId = req.auth.role === Role.AGENT ? req.auth.sub : input.assignedSalespersonId;
    // A shop registered by a salesperson is a completed submission, not a local
    // draft. This makes it immediately visible in the manager's Pending
    // Approvals queue while keeping it unavailable as an approved retailer
    // until the manager reviews it.
    const status = req.auth.role === Role.AGENT ? RetailerStatus.SUBMITTED : input.active ? RetailerStatus.UNDER_REVIEW : RetailerStatus.INACTIVE;
    const brVerificationStatus = input.brNumber ? RetailerDocumentStatus.PENDING : (RetailerDocumentStatus.NOT_PROVIDED || 'NOT_PROVIDED');
    
    const shopData = {
        id: shopId, tenantId: req.auth.tenantId, assignedSalespersonId: assignedSalespersonId ?? null, status, active: input.active, brVerificationStatus,
        name: input.name, ownerName: input.ownerName, phone: input.phone, alternateMobile: input.alternateMobile ?? null, email: input.email ?? null,
        address: input.address, city: input.city, latitude: input.latitude ?? null, longitude: input.longitude ?? null, allowedVisitRadiusMeters: input.allowedVisitRadiusMeters ?? null,
        routeGroup: input.routeGroup ?? null, outstandingBalanceLkr: input.outstandingBalanceLkr, preferredProducts: JSON.stringify(input.preferredProducts), requiredProducts: JSON.stringify(input.requiredProducts),
        notes: input.notes ?? null, paymentMethod: input.paymentMethod, paymentTerms: input.paymentTerms ?? null, creditLimitLkr: input.creditLimitLkr,
        nicNumber: input.nicNumber ?? null, brNumber: input.brNumber ?? null, whatsappNumber: input.whatsappNumber ?? null, district: input.district ?? null,
        country: input.country, territory: input.territory ?? null, shopCategory: input.shopCategory ?? null, retailerType: input.retailerType ?? null,
        gpsAccuracy: input.gpsAccuracy ?? null, gpsCapturedAt: input.gpsCapturedAt ? new Date(input.gpsCapturedAt) : null, productCategories: JSON.stringify(input.productCategories),
        expectedMonthlyPurchase: input.expectedMonthlyPurchase, currentSupplier: input.currentSupplier ?? null, deliveryPreference: input.deliveryPreference ?? null, preferredVisitDays: JSON.stringify(input.preferredVisitDays),
        shopRequirements: input.shopRequirements ?? null, salesNotes: input.salesNotes ?? null, retailerCode: null, createdAt: new Date(), updatedAt: new Date()
    };
    
    const keys = Object.keys(shopData);
    const placeholders = keys.map(() => '?').join(',');
    
    const connection = await db.getConnection();
    let shop;
    try {
        await connection.beginTransaction();
        const [latestCodes] = await connection.query(
            'SELECT retailerCode FROM Shop WHERE tenantId = ? AND retailerCode REGEXP ? ORDER BY CAST(retailerCode AS UNSIGNED) DESC LIMIT 1 FOR UPDATE',
            [req.auth.tenantId, '^[0-9]+$'],
        );
        const nextShopNumber = Number(latestCodes[0]?.retailerCode || 0) + 1;
        shopData.retailerCode = String(nextShopNumber).padStart(10, '0');
        const values = keys.map(k => shopData[k]);
        await connection.query(`INSERT INTO Shop (${keys.join(',')}) VALUES (${placeholders})`, values);
        const [createdShops] = await connection.query('SELECT * FROM Shop WHERE id = ?', [shopId]);
        shop = createdShops[0];
        await auditRetailer(req.auth.tenantId, req.auth.sub, 'RETAILER_CREATED', shop.id, { role: req.auth.role }, connection);
        await notifySalesVisibility(req, 'NEW_RETAILER', 'New retailer added', `${shop.name} was added to the sales network.`, 'sales:new-retailer', shop, connection, false);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    const io = req.app.get('io');
    io?.to(`tenant:${req.auth.tenantId}:role:${Role.ADMIN}`).to(`tenant:${req.auth.tenantId}:role:${Role.MANAGER}`).to(`tenant:${req.auth.tenantId}:role:${Role.FACTORY_MANAGER}`).emit('sales:new-retailer', shop);
    io?.to(`tenant:${req.auth.tenantId}:role:${Role.ADMIN}`).to(`tenant:${req.auth.tenantId}:role:${Role.MANAGER}`).to(`tenant:${req.auth.tenantId}:role:${Role.FACTORY_MANAGER}`).emit('notification:created', {
        type: 'NEW_RETAILER',
        title: 'New shop registered',
        message: `${shop.name} was added to the sales network.`,
        shopId: shop.id,
    });
    res.status(201).json(shop);
});

shopRouter.get('/visits', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM ShopVisit WHERE tenantId = ? AND visitedAt >= ? AND visitedAt <= ?', [req.auth.tenantId, from, to]);
    const total = countResult[0].total;
    
    const [visits] = await db.query(
        'SELECT * FROM ShopVisit WHERE tenantId = ? AND visitedAt >= ? AND visitedAt <= ? ORDER BY visitedAt DESC LIMIT ? OFFSET ?',
        [req.auth.tenantId, from, to, limit, (page - 1) * limit]
    );
    
    const items = [...visits];
    if (items.length > 0) {
        const shopIds = [...new Set(items.map(v => v.shopId))];
        const agentIds = [...new Set(items.map(v => v.agentId))];
        
        const [[shops], [agents]] = await Promise.all([
            db.query(`SELECT * FROM Shop WHERE id IN (${shopIds.map(() => '?').join(',')})`, shopIds),
            db.query(`SELECT id, name, avatarUrl FROM User WHERE id IN (${agentIds.map(() => '?').join(',')})`, agentIds)
        ]);
        
        const shopsMap = new Map(shops.map(s => [s.id, s]));
        const agentsMap = new Map(agents.map(a => [a.id, a]));
        
        for (const item of items) {
            item.shop = shopsMap.get(item.shopId) ?? null;
            item.agent = agentsMap.get(item.agentId) ?? null;
            if (item.agent) {
                const [locs] = await db.query('SELECT * FROM LocationPing WHERE agentId = ? ORDER BY recordedAt DESC LIMIT 1', [item.agentId]);
                item.agent.locations = locs;
            }
        }
    }
    
    res.json({ items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

shopRouter.get('/retailer-analytics', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const tenantId = req.auth.tenantId;
    const month = new Date();
    month.setDate(1);
    month.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [[totalRes], [activeRes], [pendingRes], [newThisMonthRes], [visitedTodayRes], [withOrdersRes]] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM Shop WHERE tenantId = ?', [tenantId]),
        db.query('SELECT COUNT(*) as c FROM Shop WHERE tenantId = ? AND status = ? AND active = ?', [tenantId, RetailerStatus.APPROVED, true]),
        db.query('SELECT COUNT(*) as c FROM Shop WHERE tenantId = ? AND status IN (?, ?)', [tenantId, RetailerStatus.SUBMITTED, RetailerStatus.UNDER_REVIEW]),
        db.query('SELECT COUNT(*) as c FROM Shop WHERE tenantId = ? AND createdAt >= ?', [tenantId, month]),
        db.query('SELECT COUNT(DISTINCT shopId) as c FROM ShopVisit WHERE tenantId = ? AND visitedAt >= ?', [tenantId, today]),
        db.query('SELECT COUNT(DISTINCT shopId) as c FROM `Order` WHERE tenantId = ?', [tenantId])
    ]);
    
    const total = totalRes[0].c;
    const active = activeRes[0].c;
    const pending = pendingRes[0].c;
    const newThisMonth = newThisMonthRes[0].c;
    const visitedToday = visitedTodayRes[0].c;
    const withOrders = withOrdersRes[0].c;
    
    res.json({ total, active, pending, newThisMonth, visitedToday, notVisited: total - visitedToday, withOrders, withoutOrders: total - withOrders });
});

shopRouter.post('/:id/documents', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), upload.single('document'), async (req, res) => {
    if (!req.file) {
        res.status(422).json({ error: { code: 'DOCUMENT_REQUIRED' } });
        return;
    }
    const type = z.nativeEnum(RetailerDocumentType).parse(req.body.type);
    
    let shopQuery = 'SELECT id, latitude, longitude, locationVerificationRequired FROM Shop WHERE id = ? AND tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopQuery += ' AND assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    shopQuery += ' LIMIT 1';
    
    const [shops] = await db.query(shopQuery, params);
    const shop = shops[0];
    
    if (!shop) {
        res.status(404).json({ error: { code: 'RETAILER_NOT_FOUND' } });
        return;
    }
    
    const captureLatitude = req.body.captureLatitude ? Number(req.body.captureLatitude) : null;
    const captureLongitude = req.body.captureLongitude ? Number(req.body.captureLongitude) : null;
    
    let locationVerificationRequired = shop.locationVerificationRequired;
    if (type === RetailerDocumentType.SHOP_FRONT && shop.latitude != null && shop.longitude != null && captureLatitude != null && captureLongitude != null)
        locationVerificationRequired = haversine(shop.latitude, shop.longitude, captureLatitude, captureLongitude) > 250;
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let row;
    try {
        const file = await createFileAsset(req.auth.tenantId, req.auth.sub, toStoredUpload(req.file), connection);
        
        const docId = randomUUID();
        const capturedAt = new Date();
        
        await connection.query(
            'INSERT INTO ShopDocument (id, tenantId, shopId, fileId, type, status, captureLatitude, captureLongitude, capturedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE fileId = VALUES(fileId), status = VALUES(status), captureLatitude = VALUES(captureLatitude), captureLongitude = VALUES(captureLongitude), capturedAt = VALUES(capturedAt)',
            [docId, req.auth.tenantId, shop.id, file.id, type, RetailerDocumentStatus.PENDING, captureLatitude, captureLongitude, capturedAt]
        );
        
        if (locationVerificationRequired !== shop.locationVerificationRequired) {
            await connection.query('UPDATE Shop SET locationVerificationRequired = ? WHERE id = ?', [locationVerificationRequired, shop.id]);
        }
        
        const [docs] = await connection.query('SELECT * FROM ShopDocument WHERE shopId = ? AND type = ?', [shop.id, type]);
        row = docs[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    await auditRetailer(req.auth.tenantId, req.auth.sub, 'RETAILER_DOCUMENT_UPLOADED', shop.id, { type, fileHash: createHash('sha256').update(req.file.buffer).digest('hex') });
    res.status(201).json(row);
});

shopRouter.post('/:id/images', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), imageUpload.single('image'), async (req, res) => {
    if (!req.file)
        return res.status(422).json({ error: { code: 'IMAGE_REQUIRED', message: 'Choose an image to upload' } });
    const shopId = String(req.params.id);
    
    let shopQuery = 'SELECT id, retailerCode FROM Shop WHERE id = ? AND tenantId = ?';
    const params = [shopId, req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopQuery += ' AND assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [shops] = await db.query(shopQuery, params);
    if (!shops[0]) return res.status(404).json({ error: { code: 'SHOP_NOT_FOUND' } });
    let retailerCode = shops[0].retailerCode;
    // Older shops may predate retailer IDs. Assign the same ten-digit ID
    // automatically when their first image is uploaded.
    if (!retailerCode) {
        const [latest] = await db.query(
            'SELECT retailerCode FROM Shop WHERE tenantId = ? AND retailerCode REGEXP ? ORDER BY CAST(retailerCode AS UNSIGNED) DESC LIMIT 1',
            [req.auth.tenantId, '^[0-9]+$'],
        );
        retailerCode = String(Number(latest[0]?.retailerCode || 0) + 1).padStart(10, '0').slice(-10);
        await db.query('UPDATE Shop SET retailerCode = ? WHERE id = ? AND tenantId = ?', [retailerCode, shopId, req.auth.tenantId]);
    }
    
    const [countRes] = await db.query('SELECT COUNT(*) as c FROM ShopImage WHERE shopId = ?', [shopId]);
    const imageCount = countRes[0].c;
    if (imageCount >= 10) return res.status(422).json({ error: { code: 'SHOP_IMAGE_LIMIT', message: 'A shop can have up to 10 images' } });
    
    const type = z.nativeEnum(ShopImageType).parse(req.body.type);
    const requestedPrimary = String(req.body.isPrimary) === 'true';
    const visitId = req.body.visitId ? String(req.body.visitId) : undefined;
    
    if (visitId && req.auth.role === Role.AGENT) {
        const [visits] = await db.query('SELECT id FROM ShopVisit WHERE id = ? AND shopId = ? AND agentId = ? AND tenantId = ?', [visitId, shopId, req.auth.sub, req.auth.tenantId]);
        if (visits.length === 0) return res.status(403).json({ error: { code: 'FORBIDDEN' } });
    }
    
    const stored = await uploadPermanentImage(req.file, req.auth.tenantId, 'shops');
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        if (requestedPrimary || imageCount === 0) {
            await connection.query('UPDATE ShopImage SET isPrimary = false WHERE shopId = ?', [shopId]);
        }
        
        const fileId = randomUUID();
        await connection.query(
            'INSERT INTO FileAsset (id, tenantId, uploadedById, originalName, storageKey, storageProvider, publicUrl, mimeType, sizeBytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [fileId, req.auth.tenantId, req.auth.sub, stored.originalName, stored.storageKey, 'LOCAL', stored.publicUrl, stored.mimeType, stored.sizeBytes]
        );
        
        const imageId = randomUUID();
        const isPrimary = requestedPrimary || imageCount === 0;
        await connection.query(
            'INSERT INTO ShopImage (id, tenantId, shopId, visitId, fileId, url, type, isPrimary, displayOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [imageId, req.auth.tenantId, shopId, visitId ?? null, fileId, stored.publicUrl, type, isPrimary, imageCount]
        );
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'SHOP_IMAGE_ADDED', 'Retailer', shopId, JSON.stringify({ type })]
        );
        
        const [images] = await connection.query('SELECT * FROM ShopImage WHERE id = ?', [imageId]);
        await connection.commit();
        return res.status(201).json({ ...images[0], shopId, retailerCode });
    } catch (error) {
        await connection.rollback();
        await deletePermanentImage(stored.storageKey).catch(() => undefined);
        throw error;
    } finally {
        connection.release();
    }
});

shopRouter.patch('/:id/images/:imageId', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => {
    const shopId = String(req.params.id);
    const imageId = String(req.params.imageId);
    
    let shopQuery = 'SELECT id FROM Shop WHERE id = ? AND tenantId = ?';
    const params = [shopId, req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopQuery += ' AND assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [shops] = await db.query(shopQuery, params);
    if (!shops[0]) return res.status(404).json({ error: { code: 'SHOP_NOT_FOUND' } });
    
    const input = z.object({ type: z.nativeEnum(ShopImageType).optional(), isPrimary: z.boolean().optional(), displayOrder: z.number().int().min(0).optional() }).parse(req.body);
    const [currentImages] = await db.query('SELECT * FROM ShopImage WHERE id = ? AND shopId = ? AND tenantId = ?', [imageId, shopId, req.auth.tenantId]);
    if (!currentImages[0]) return res.status(404).json({ error: { code: 'IMAGE_NOT_FOUND' } });
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        if (input.isPrimary) {
            await connection.query('UPDATE ShopImage SET isPrimary = false WHERE shopId = ?', [shopId]);
        }
        
        const updateFields = [];
        const updateParams = [];
        if (input.type !== undefined) { updateFields.push('type = ?'); updateParams.push(input.type); }
        if (input.isPrimary !== undefined) { updateFields.push('isPrimary = ?'); updateParams.push(input.isPrimary); }
        if (input.displayOrder !== undefined) { updateFields.push('displayOrder = ?'); updateParams.push(input.displayOrder); }
        
        if (updateFields.length > 0) {
            await connection.query(`UPDATE ShopImage SET ${updateFields.join(', ')} WHERE id = ?`, [...updateParams, imageId]);
        }
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId) VALUES (?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'SHOP_IMAGE_UPDATED', 'Retailer', shopId]
        );
        
        const [updated] = await connection.query('SELECT * FROM ShopImage WHERE id = ?', [imageId]);
        await connection.commit();
        return res.json(updated[0]);
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

shopRouter.delete('/:id/images/:imageId', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => {
    const shopId = String(req.params.id);
    const imageId = String(req.params.imageId);
    
    let shopQuery = 'SELECT id FROM Shop WHERE id = ? AND tenantId = ?';
    const params = [shopId, req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopQuery += ' AND assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [shops] = await db.query(shopQuery, params);
    if (!shops[0]) return res.status(404).json({ error: { code: 'SHOP_NOT_FOUND' } });
    
    const [currentImages] = await db.query('SELECT i.*, f.storageKey FROM ShopImage i JOIN FileAsset f ON i.fileId = f.id WHERE i.id = ? AND i.shopId = ? AND i.tenantId = ?', [imageId, shopId, req.auth.tenantId]);
    const current = currentImages[0];
    if (!current) return res.status(404).json({ error: { code: 'IMAGE_NOT_FOUND' } });
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('DELETE FROM ShopImage WHERE id = ?', [imageId]);
        if (current.isPrimary) {
            const [next] = await connection.query('SELECT id FROM ShopImage WHERE shopId = ? ORDER BY displayOrder ASC, createdAt ASC LIMIT 1', [shopId]);
            if (next.length > 0) {
                await connection.query('UPDATE ShopImage SET isPrimary = true WHERE id = ?', [next[0].id]);
            }
        }
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId) VALUES (?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'SHOP_IMAGE_DELETED', 'Retailer', shopId]
        );
        await connection.query('DELETE FROM FileAsset WHERE id = ?', [current.fileId]);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    await deletePermanentImage(current.storageKey).catch(() => undefined);
    return res.status(204).end();
});

shopRouter.get('/:id/documents/:type', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER, Role.AGENT), async (req, res) => { 
    const type = z.nativeEnum(RetailerDocumentType).parse(req.params.type); 
    
    let docQuery = 'SELECT d.*, f.originalName, f.mimeType, f.storageKey FROM ShopDocument d JOIN FileAsset f ON d.fileId = f.id JOIN Shop s ON d.shopId = s.id WHERE d.tenantId = ? AND d.shopId = ? AND d.type = ?';
    const params = [req.auth.tenantId, String(req.params.id), type];
    if (req.auth.role === Role.AGENT) {
        docQuery += ' AND s.assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [docs] = await db.query(docQuery, params);
    const doc = docs[0];
    
    if (!doc) {
        res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND' } });
        return;
    } 
    res.type(doc.mimeType); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', `inline; filename="${doc.originalName.replace(/["\r\n]/g, '_')}"`); return redirectToSignedObject(res, doc.storageKey); 
});

shopRouter.delete('/:id/documents/:type', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => { 
    const type = z.nativeEnum(RetailerDocumentType).parse(req.params.type); 
    
    let shopCheck = 'SELECT s.id FROM Shop s WHERE s.id = ? AND s.tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopCheck += ' AND s.assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [shops] = await db.query(shopCheck, params);
    if (shops.length === 0) return res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND' } });
    
    const [result] = await db.query('DELETE FROM ShopDocument WHERE tenantId = ? AND shopId = ? AND type = ?', [req.auth.tenantId, String(req.params.id), type]);
    if (result.affectedRows === 0) {
        res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND' } });
        return;
    } 
    await auditRetailer(req.auth.tenantId, req.auth.sub, 'RETAILER_DOCUMENT_DELETED', String(req.params.id), { type }); 
    res.status(204).end(); 
});

shopRouter.post('/:id/submit', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => { 
    let shopQuery = 'SELECT id FROM Shop WHERE id = ? AND tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopQuery += ' AND assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [shops] = await db.query(shopQuery, params);
    const shop = shops[0];
    
    if (!shop) {
        res.status(404).json({ error: { code: 'RETAILER_NOT_FOUND' } });
        return;
    } 
    
    const [docs] = await db.query('SELECT type FROM ShopDocument WHERE shopId = ?', [shop.id]);
    const types = new Set(docs.map(d => d.type)); 
    const required = [RetailerDocumentType.NIC_FRONT, RetailerDocumentType.NIC_BACK, RetailerDocumentType.SHOP_FRONT]; 
    const missing = required.filter(type => !types.has(type)); 
    if (missing.length) {
        res.status(422).json({ error: { code: 'REQUIRED_DOCUMENTS_MISSING', details: missing } });
        return;
    } 
    
    await db.query('UPDATE Shop SET status = ?, submittedAt = ? WHERE id = ?', [RetailerStatus.SUBMITTED, new Date(), shop.id]);
    const [updated] = await db.query('SELECT * FROM Shop WHERE id = ?', [shop.id]);
    await auditRetailer(req.auth.tenantId, req.auth.sub, 'RETAILER_SUBMITTED', shop.id); 
    res.json(updated[0]); 
});

shopRouter.patch('/:id/review', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const input = z.object({ action: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'SUSPEND', 'REACTIVATE', 'DEACTIVATE']), reason: z.string().trim().max(1000).optional() }).parse(req.body);
    if (['REJECT', 'REQUEST_CHANGES'].includes(input.action) && !input.reason) {
        res.status(422).json({ error: { code: 'REASON_REQUIRED' } });
        return;
    }
    const [currentShops] = await db.query('SELECT * FROM Shop WHERE id = ? AND tenantId = ?', [String(req.params.id), req.auth.tenantId]);
    const current = currentShops[0];
    if (!current) {
        res.status(404).json({ error: { code: 'RETAILER_NOT_FOUND' } });
        return;
    }
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        let retailerCode = current.retailerCode; 
        if (input.action === 'APPROVE' && !retailerCode) {
            await connection.query(`SELECT pg_advisory_xact_lock(hashtext('retailer-code:${req.auth.tenantId}'))`).catch(() => {}); // Optional fallback
            const [latest] = await connection.query('SELECT retailerCode FROM Shop WHERE tenantId = ? AND retailerCode IS NOT NULL ORDER BY retailerCode DESC LIMIT 1', [req.auth.tenantId]);
            const next = Number(latest[0]?.retailerCode?.split('-').pop() || 0) + 1;
            // Retailer IDs are intentionally numeric and exactly ten digits so
            // they can be printed/scanned consistently across sales and manager apps.
            retailerCode = String(next).padStart(10, '0').slice(-10);
        } 
        const status = input.action === 'APPROVE' ? RetailerStatus.APPROVED : input.action === 'REJECT' ? RetailerStatus.REJECTED : input.action === 'REQUEST_CHANGES' ? RetailerStatus.DRAFT : input.action === 'SUSPEND' ? RetailerStatus.SUSPENDED : input.action === 'DEACTIVATE' ? RetailerStatus.INACTIVE : RetailerStatus.APPROVED; 
        
        await connection.query(
            'UPDATE Shop SET status = ?, active = ?, retailerCode = ?, reviewedAt = ?, reviewedById = ?, reviewReason = ? WHERE id = ?',
            [status, status !== RetailerStatus.SUSPENDED && status !== RetailerStatus.INACTIVE, retailerCode, new Date(), req.auth.sub, input.reason ?? null, current.id]
        );
        
        const [res] = await connection.query('SELECT * FROM Shop WHERE id = ?', [current.id]);
        updated = res[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    await auditRetailer(req.auth.tenantId, req.auth.sub, `RETAILER_${input.action}`, current.id, { reason: input.reason, role: req.auth.role });
    res.json(updated);
});

shopRouter.post('/:id/visits', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => {
    const input = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().positive().optional(), notes: z.string().max(1000).optional(), routeStopId: z.string().optional(), clientOperationId: z.string().max(160).optional() }).parse(req.body);
    const [shops] = await db.query('SELECT * FROM Shop WHERE id = ? AND tenantId = ? AND active = ?', [String(req.params.id), req.auth.tenantId, true]);
    const shop = shops[0];
    if (!shop) {
        res.status(404).json({ error: { code: 'SHOP_NOT_FOUND' } });
        return;
    }
    const operationId = input.clientOperationId ?? (String(req.header('X-Idempotency-Key') ?? '') || undefined);
    if (operationId) {
        const [existing] = await db.query('SELECT * FROM ShopVisit WHERE agentId = ? AND clientOperationId = ? LIMIT 1', [req.auth.sub, operationId]);
        if (existing.length > 0)
            return res.json(existing[0]);
    }
    const [settings] = await db.query('SELECT geofenceRadiusMeters FROM TenantSettings WHERE tenantId = ? LIMIT 1', [req.auth.tenantId]);
    const allowedRadius = shop.allowedVisitRadiusMeters ?? settings[0]?.geofenceRadiusMeters ?? 100;
    const distanceFromShopMeters = shop.latitude != null && shop.longitude != null ? haversine(shop.latitude, shop.longitude, input.latitude, input.longitude) : null;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let visit;
    try {
        const visitId = randomUUID();
        const visitedAt = new Date();
        await connection.query(
            'INSERT INTO ShopVisit (id, tenantId, shopId, agentId, latitude, longitude, accuracy, notes, routeStopId, clientOperationId, distanceFromShopMeters, outsideRetailerLocation, visitedAt, productsDiscussed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [visitId, req.auth.tenantId, shop.id, req.auth.sub, input.latitude, input.longitude, input.accuracy ?? null, input.notes ?? null, input.routeStopId ?? null, operationId ?? null, distanceFromShopMeters, distanceFromShopMeters != null && distanceFromShopMeters > allowedRadius, visitedAt, '[]']
        );
        
        if (input.routeStopId) {
            await connection.query(
                'UPDATE AgentRouteStop rs JOIN AgentRoutePlan rp ON rs.routePlanId = rp.id SET rs.status = ? WHERE rs.id = ? AND rp.agentId = ? AND rs.shopId = ?',
                ['VISITED', input.routeStopId, req.auth.sub, shop.id]
            );
        }
        await connection.query('UPDATE Shop SET lastVisitAt = ? WHERE id = ?', [visitedAt, shop.id]);
        
        const [res] = await connection.query('SELECT * FROM ShopVisit WHERE id = ?', [visitId]);
        visit = res[0];
        await recordAgentActivity({ tenantId: req.auth.tenantId, agentId: req.auth.sub, visitId: visit.id, eventType: 'SHOP_CHECK_IN', occurredAt: visit.visitedAt, latitude: visit.latitude, longitude: visit.longitude, entityType: 'ShopVisit', entityId: visit.id, sourceKey: `visit:${visit.id}:in`, metadata: { title: `Checked in at ${shop.name}` } }, connection);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    await notifySalesVisibility(req, 'SHOP_VISITED', 'Salesperson visit recorded', `A visit to ${shop.name} was recorded.`, 'shop:visited', visit);
    res.status(201).json(visit);
});

shopRouter.get('/visits/mine/active', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => {
    const [visits] = await db.query('SELECT * FROM ShopVisit WHERE tenantId = ? AND agentId = ? AND departedAt IS NULL ORDER BY visitedAt DESC LIMIT 1', [req.auth.tenantId, req.auth.sub]);
    const visit = visits[0];
    if (!visit) return res.json(null);
    
    const [[shops], [images], [orders]] = await Promise.all([
        db.query('SELECT * FROM Shop WHERE id = ?', [visit.shopId]),
        db.query('SELECT * FROM ShopVisitImage WHERE shopVisitId = ?', [visit.id]),
        db.query('SELECT * FROM `Order` WHERE shopVisitId = ?', [visit.id])
    ]);
    
    visit.shop = shops[0] ?? null;
    if (visit.shop) {
        const [shopImages] = await db.query('SELECT * FROM ShopImage WHERE shopId = ?', [visit.shop.id]);
        visit.shop.images = shopImages;
    }
    visit.images = images;
    
    if (orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        const [invoices] = await db.query(`SELECT * FROM Invoice WHERE orderId IN (${orderIds.map(() => '?').join(',')})`, orderIds);
        
        let payments = [];
        if (invoices.length > 0) {
            const invoiceIds = invoices.map(i => i.id);
            [payments] = await db.query(`SELECT * FROM Payment WHERE invoiceId IN (${invoiceIds.map(() => '?').join(',')})`, invoiceIds);
        }
        
        const paymentsByInvoice = new Map();
        payments.forEach(p => {
            if (!paymentsByInvoice.has(p.invoiceId)) paymentsByInvoice.set(p.invoiceId, []);
            paymentsByInvoice.get(p.invoiceId).push(p);
        });
        
        const invoicesByOrder = new Map();
        invoices.forEach(i => {
            i.payments = paymentsByInvoice.get(i.id) ?? [];
            invoicesByOrder.set(i.orderId, i);
        });
        
        visit.orders = orders.map(o => ({ ...o, invoice: invoicesByOrder.get(o.id) ?? null }));
    } else {
        visit.orders = [];
    }
    
    res.json(visit);
});

shopRouter.post('/visits/entry', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => {
    const input = z.object({ shopId: z.string().optional(), newShop: z.object({ name: z.string().min(2), ownerName: z.string().min(2), phone: z.string().min(7), address: z.string().min(5), city: z.string().min(2) }).optional(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().positive().optional(), purpose: z.string().max(500).optional(), productsDiscussed: z.array(z.string().max(150)).max(50).default([]), notes: z.string().max(2000).optional(), routeStopId: z.string().optional(), clientOperationId: z.string().max(160).optional() }).refine(value => Boolean(value.shopId) !== Boolean(value.newShop), { message: 'Choose an existing shop or enter a new shop' }).parse(req.body);
    const operationId = input.clientOperationId ?? (String(req.header('X-Idempotency-Key') ?? '') || undefined);
    
    if (operationId) {
        const [existing] = await db.query('SELECT v.*, s.name as s_name FROM ShopVisit v JOIN Shop s ON v.shopId = s.id WHERE v.agentId = ? AND v.clientOperationId = ? LIMIT 1', [req.auth.sub, operationId]);
        if (existing.length > 0) {
            const e = existing[0];
            e.shop = { id: e.shopId, name: e.s_name };
            return res.json(e);
        }
    }
    
    const [activeVisits] = await db.query('SELECT id FROM ShopVisit WHERE tenantId = ? AND agentId = ? AND departedAt IS NULL LIMIT 1', [req.auth.tenantId, req.auth.sub]);
    if (activeVisits.length > 0)
        return res.status(409).json({ error: { code: 'ACTIVE_VISIT_EXISTS', message: 'Check out of the active visit first' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let result;
    try {
        let shop;
        if (input.newShop) {
            const shopId = randomUUID();
            await connection.query(
                'INSERT INTO Shop (id, tenantId, assignedSalespersonId, status, latitude, longitude, name, ownerName, phone, address, city, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [shopId, req.auth.tenantId, req.auth.sub, 'DRAFT', input.latitude, input.longitude, input.newShop.name, input.newShop.ownerName, input.newShop.phone, input.newShop.address, input.newShop.city, true, new Date()]
            );
            const [shops] = await connection.query('SELECT * FROM Shop WHERE id = ?', [shopId]);
            shop = shops[0];
        } else {
            const [shops] = await connection.query('SELECT * FROM Shop WHERE id = ? AND tenantId = ? AND active = ? AND assignedSalespersonId = ?', [input.shopId, req.auth.tenantId, true, req.auth.sub]);
            shop = shops[0];
        }
        
        if (!shop) throw new Error('SHOP_NOT_AVAILABLE');
        
        const [settings] = await connection.query('SELECT geofenceRadiusMeters FROM TenantSettings WHERE tenantId = ? LIMIT 1', [req.auth.tenantId]);
        const allowedRadius = shop.allowedVisitRadiusMeters ?? settings[0]?.geofenceRadiusMeters ?? 100;
        const distanceFromShopMeters = shop.latitude != null && shop.longitude != null ? haversine(shop.latitude, shop.longitude, input.latitude, input.longitude) : null;
        
        const visitId = randomUUID();
        const visitedAt = new Date();
        
        await connection.query(
            'INSERT INTO ShopVisit (id, tenantId, agentId, shopId, latitude, longitude, accuracy, purpose, productsDiscussed, notes, routeStopId, clientOperationId, distanceFromShopMeters, outsideRetailerLocation, visitedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [visitId, req.auth.tenantId, req.auth.sub, shop.id, input.latitude, input.longitude, input.accuracy ?? null, input.purpose ?? null, JSON.stringify(input.productsDiscussed), input.notes ?? null, input.routeStopId ?? null, operationId ?? null, distanceFromShopMeters, distanceFromShopMeters != null && distanceFromShopMeters > allowedRadius, visitedAt]
        );
        
        if (input.routeStopId) {
            await connection.query(
                'UPDATE AgentRouteStop rs JOIN AgentRoutePlan rp ON rs.routePlanId = rp.id SET rs.status = ? WHERE rs.id = ? AND rp.agentId = ? AND rs.shopId = ?',
                ['VISITED', input.routeStopId, req.auth.sub, shop.id]
            );
        }
        await connection.query('UPDATE Shop SET lastVisitAt = ? WHERE id = ?', [visitedAt, shop.id]);
        
        const [visits] = await connection.query('SELECT * FROM ShopVisit WHERE id = ?', [visitId]);
        const visit = visits[0];
        
        await recordAgentActivity({ tenantId: req.auth.tenantId, agentId: req.auth.sub, visitId: visit.id, eventType: 'SHOP_CHECK_IN', occurredAt: visit.visitedAt, latitude: visit.latitude, longitude: visit.longitude, entityType: 'ShopVisit', entityId: visit.id, sourceKey: `visit:${visit.id}:in`, metadata: { title: `Checked in at ${shop.name}` } }, connection);
        
        result = { ...visit, shop };
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        if (err.message === 'SHOP_NOT_AVAILABLE') return res.status(404).json({ error: { code: 'SHOP_NOT_AVAILABLE' } });
        throw err;
    } finally {
        connection.release();
    }
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('activity:updated', { agentId: req.auth.sub, visitId: result.id, type: 'SHOP_CHECK_IN' });
    return res.status(201).json(result);
});

shopRouter.patch('/visits/:visitId', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({ purpose: z.string().max(500).optional(), productsDiscussed: z.array(z.string().max(150)).max(50).optional(), notes: z.string().max(2000).optional() }).parse(req.body);
    const [visits] = await db.query('SELECT id FROM ShopVisit WHERE id = ? AND tenantId = ? AND agentId = ?', [String(req.params.visitId), req.auth.tenantId, req.auth.sub]);
    if (visits.length === 0)
        return res.status(404).json({ error: { code: 'VISIT_NOT_FOUND' } });
        
    const updateFields = [];
    const updateParams = [];
    if (input.purpose !== undefined) { updateFields.push('purpose = ?'); updateParams.push(input.purpose); }
    if (input.productsDiscussed !== undefined) { updateFields.push('productsDiscussed = ?'); updateParams.push(JSON.stringify(input.productsDiscussed)); }
    if (input.notes !== undefined) { updateFields.push('notes = ?'); updateParams.push(input.notes); }
    
    if (updateFields.length > 0) {
        await db.query(`UPDATE ShopVisit SET ${updateFields.join(', ')} WHERE id = ?`, [...updateParams, String(req.params.visitId)]);
    }
    
    const [updated] = await db.query('SELECT * FROM ShopVisit WHERE id = ?', [String(req.params.visitId)]);
    return res.json(updated[0]);
});

shopRouter.post('/visits/:visitId/geofence-exception', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({ reason: z.enum(['GPS_INACCURATE', 'SHOP_ENTRANCE_MOVED', 'ROADSIDE_MEETING']), note: z.string().trim().min(10).max(1000) }).parse(req.body);
    const [visits] = await db.query('SELECT * FROM ShopVisit WHERE id = ? AND tenantId = ? AND agentId = ?', [String(req.params.visitId), req.auth.tenantId, req.auth.sub]);
    const visit = visits[0];
    if (!visit)
        return res.status(404).json({ error: { code: 'VISIT_NOT_FOUND' } });
    if (!visit.outsideRetailerLocation)
        return res.status(409).json({ error: { code: 'EXCEPTION_NOT_REQUIRED', message: 'This visit is already GPS verified.' } });
        
    await db.query(
        'UPDATE ShopVisit SET geofenceExceptionReason = ?, geofenceExceptionNote = ?, geofenceExceptionStatus = ? WHERE id = ?',
        [input.reason, input.note, 'PENDING', visit.id]
    );
    const [updated] = await db.query('SELECT * FROM ShopVisit WHERE id = ?', [visit.id]);
    return res.json(updated[0]);
});

shopRouter.post('/visits/:visitId/payments', authorize(Role.AGENT), async (req, res) => { 
    const input = z.object({ invoiceId: z.string(), amountLkr: z.number().positive(), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT']), reference: z.string().max(120).optional() }).parse(req.body); 
    const visitId = String(req.params.visitId);
    
    const [visits] = await db.query('SELECT id FROM ShopVisit WHERE id = ? AND tenantId = ? AND agentId = ?', [visitId, req.auth.tenantId, req.auth.sub]);
    if (visits.length === 0) return res.status(403).json({ error: { code: 'INVALID_VISIT_INVOICE' } });
    
    const [invoices] = await db.query('SELECT i.* FROM Invoice i JOIN `Order` o ON i.orderId = o.id WHERE i.id = ? AND o.shopVisitId = ?', [input.invoiceId, visitId]);
    const invoice = invoices[0];
    if (!invoice) return res.status(403).json({ error: { code: 'INVALID_VISIT_INVOICE' } });
    
    const remaining = Number(invoice.totalLkr) - Number(invoice.paidLkr); 
    if (input.amountLkr > remaining + .01)
        return res.status(422).json({ error: { code: 'PAYMENT_EXCEEDS_BALANCE' } }); 
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let payment;
    try {
        const paymentId = randomUUID();
        const paidAt = new Date();
        await connection.query(
            'INSERT INTO Payment (id, tenantId, invoiceId, amountLkr, method, reference, recordedById, paidAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [paymentId, req.auth.tenantId, invoice.id, input.amountLkr, input.method, input.reference ?? null, req.auth.sub, paidAt]
        );
        
        const paidLkr = Number(invoice.paidLkr) + input.amountLkr; 
        await connection.query(
            'UPDATE Invoice SET paidLkr = ?, status = ? WHERE id = ?',
            [paidLkr, paidLkr >= Number(invoice.totalLkr) ? 'PAID' : 'PARTIAL', invoice.id]
        );
        
        await recordAgentActivity({ tenantId: req.auth.tenantId, agentId: req.auth.sub, visitId, eventType: 'PAYMENT_COLLECTED', occurredAt: paidAt, entityType: 'Payment', entityId: paymentId, sourceKey: `payment:${paymentId}`, metadata: { title: 'Payment collected', detail: `LKR ${input.amountLkr.toLocaleString()} · ${input.method}` } }, connection); 
        
        const [res] = await connection.query('SELECT * FROM Payment WHERE id = ?', [paymentId]);
        payment = res[0];
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('activity:updated', { agentId: req.auth.sub, visitId, type: 'PAYMENT_COLLECTED' }); 
    return res.status(201).json(payment); 
});

shopRouter.patch('/:id/visits/:visitId/check-out', authorize(Role.ADMIN, Role.MANAGER, Role.AGENT), async (req, res) => { 
    const input = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().positive().optional(), notes: z.string().max(2000).optional() }).parse(req.body); 
    
    const [visits] = await db.query(
        'SELECT v.*, s.name as s_name FROM ShopVisit v JOIN Shop s ON v.shopId = s.id WHERE v.id = ? AND v.shopId = ? AND v.tenantId = ? AND v.agentId = ? AND v.departedAt IS NULL',
        [String(req.params.visitId), String(req.params.id), req.auth.tenantId, req.auth.sub]
    );
    const visit = visits[0];
    if (!visit) {
        res.status(404).json({ error: { code: 'ACTIVE_VISIT_NOT_FOUND' } });
        return;
    } 
    
    const departedAt = new Date(); 
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        const durationMinutes = Math.max(1, Math.round((departedAt.getTime() - new Date(visit.visitedAt).getTime()) / 60000));
        await connection.query(
            'UPDATE ShopVisit SET departedAt = ?, durationMinutes = ?, notes = ?, checkoutLatitude = ?, checkoutLongitude = ?, checkoutAccuracy = ? WHERE id = ?',
            [departedAt, durationMinutes, input.notes ?? visit.notes, input.latitude, input.longitude, input.accuracy ?? null, visit.id]
        );
        
        await recordAgentActivity({ tenantId: req.auth.tenantId, agentId: req.auth.sub, visitId: visit.id, eventType: 'SHOP_CHECK_OUT', occurredAt: departedAt, latitude: input.latitude, longitude: input.longitude, entityType: 'ShopVisit', entityId: visit.id, sourceKey: `visit:${visit.id}:out`, metadata: { title: `Checked out of ${visit.s_name}`, detail: `${durationMinutes} minutes` } }, connection); 
        
        const [res] = await connection.query('SELECT * FROM ShopVisit WHERE id = ?', [visit.id]);
        updated = res[0];
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('activity:updated', { agentId: req.auth.sub, visitId: visit.id, type: 'SHOP_CHECK_OUT' }); 
    res.json(updated); 
});

shopRouter.delete("/:id", authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const shopId = String(req.params.id);
    const [shops] = await db.query('SELECT id, name, retailerCode FROM Shop WHERE id = ? AND tenantId = ?', [shopId, req.auth.tenantId]);
    const shop = shops[0];
    if (!shop)
        return res.status(404).json({ error: { code: "RETAILER_NOT_FOUND", message: "Retailer not found." } });
        
    const [documents] = await db.query('SELECT d.fileId, f.storageKey FROM ShopDocument d JOIN FileAsset f ON d.fileId = f.id WHERE d.shopId = ?', [shopId]);
    const [images] = await db.query('SELECT i.fileId, f.storageKey FROM ShopImage i JOIN FileAsset f ON i.fileId = f.id WHERE i.shopId = ?', [shopId]);
    
    const files = [...documents, ...images];
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('DELETE FROM Shop WHERE id = ?', [shopId]);
        if (files.length > 0) {
            const fileIds = files.map(f => f.fileId);
            const placeholders = fileIds.map(() => '?').join(',');
            await connection.query(`DELETE FROM FileAsset WHERE id IN (${placeholders})`, fileIds);
        }
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'RETAILER_DELETED', 'Retailer', shopId, JSON.stringify({ name: shop.name, retailerCode: shop.retailerCode })]
        );
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    await Promise.all(files.map(file => deletePermanentImage(file.storageKey).catch(() => undefined)));
    req.app.get("io")?.to(`tenant:${req.auth.tenantId}`).emit("shop:deleted", { id: shopId });
    return res.status(204).end();
});

shopRouter.get("/:id", async (req, res) => {
    let shopQuery = 'SELECT s.*, u.id as u_id, u.name as u_name FROM Shop s LEFT JOIN User u ON s.assignedSalespersonId = u.id WHERE s.id = ? AND s.tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        shopQuery += ' AND s.assignedSalespersonId = ?';
        params.push(req.auth.sub);
    }
    const [shops] = await db.query(shopQuery, params);
    let shop = shops[0];
    
    if (!shop) {
        res.status(404).json({ error: { code: 'SHOP_NOT_FOUND' } });
        return;
    }
    
    shop.assignedSalesperson = shop.u_id ? { id: shop.u_id, name: shop.u_name } : null;
    delete shop.u_id; delete shop.u_name;
    
    const [[images], [documents], [visits], [orders], [invoices], [activity]] = await Promise.all([
        db.query('SELECT * FROM ShopImage WHERE shopId = ? ORDER BY isPrimary DESC, displayOrder ASC', [shop.id]),
        db.query('SELECT d.id, d.type, d.status, d.captureLatitude, d.captureLongitude, d.capturedAt, d.createdAt, f.originalName, f.mimeType, f.sizeBytes FROM ShopDocument d JOIN FileAsset f ON d.fileId = f.id WHERE d.shopId = ?', [shop.id]),
        db.query('SELECT v.*, u.id as u_id, u.name as u_name FROM ShopVisit v JOIN User u ON v.agentId = u.id WHERE v.shopId = ? ORDER BY v.visitedAt DESC LIMIT 25', [shop.id]),
        db.query('SELECT * FROM `Order` WHERE shopId = ? ORDER BY createdAt DESC LIMIT 10', [shop.id]),
        db.query('SELECT i.* FROM Invoice i JOIN `Order` o ON i.orderId = o.id WHERE o.shopId = ? ORDER BY i.issuedAt DESC LIMIT 10', [shop.id]),
        db.query('SELECT a.*, u.name as u_name, u.role as u_role FROM AuditLog a LEFT JOIN User u ON a.actorId = u.id WHERE a.tenantId = ? AND a.entity = ? AND a.entityId = ? ORDER BY a.createdAt DESC LIMIT 50', [req.auth.tenantId, 'Retailer', shop.id])
    ]);
    
    shop.images = images;
    shop.documents = documents.map(d => ({
        id: d.id, type: d.type, status: d.status, captureLatitude: d.captureLatitude, captureLongitude: d.captureLongitude, capturedAt: d.capturedAt, createdAt: d.createdAt,
        file: { originalName: d.originalName, mimeType: d.mimeType, sizeBytes: d.sizeBytes }
    }));
    shop.visits = visits.map(v => ({ ...v, agent: { id: v.u_id, name: v.u_name }, u_id: undefined, u_name: undefined }));
    
    if (orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        const [items] = await db.query(`SELECT i.*, p.id as p_id, p.name as p_name, p.sku as p_sku FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId IN (${orderIds.map(() => '?').join(',')})`, orderIds);
        
        const itemsByOrder = new Map();
        items.forEach(i => {
            if (!itemsByOrder.has(i.orderId)) itemsByOrder.set(i.orderId, []);
            itemsByOrder.get(i.orderId).push({ ...i, product: { id: i.p_id, name: i.p_name, sku: i.p_sku }, p_id: undefined, p_name: undefined, p_sku: undefined });
        });
        
        shop.orders = orders.map(o => ({ ...o, items: itemsByOrder.get(o.id) ?? [] }));
    } else {
        shop.orders = [];
    }
    
    if (invoices.length > 0) {
        const invoiceIds = invoices.map(i => i.id);
        const [payments] = await db.query(`SELECT * FROM Payment WHERE invoiceId IN (${invoiceIds.map(() => '?').join(',')})`, invoiceIds);
        
        const paymentsByInvoice = new Map();
        payments.forEach(p => {
            if (!paymentsByInvoice.has(p.invoiceId)) paymentsByInvoice.set(p.invoiceId, []);
            paymentsByInvoice.get(p.invoiceId).push(p);
        });
        
        shop.invoices = invoices.map(i => ({ ...i, payments: paymentsByInvoice.get(i.id) ?? [] }));
    } else {
        shop.invoices = [];
    }
    
    shop.activity = activity.map(a => ({ ...a, actor: a.u_id ? { name: a.u_name, role: a.u_role } : null, u_name: undefined, u_role: undefined }));
    
    res.json(shop);
});

shopRouter.patch('/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const input = shopInput.partial().parse(req.body);
    
    const updateFields = [];
    const updateParams = [];
    for (const [key, value] of Object.entries(input)) {
        updateFields.push(`${key} = ?`);
        updateParams.push(Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : value);
    }
    
    if (updateFields.length > 0) {
        const [result] = await db.query(
            `UPDATE Shop SET ${updateFields.join(', ')} WHERE id = ? AND tenantId = ?`,
            [...updateParams, String(req.params.id), req.auth.tenantId]
        );
        if (result.affectedRows === 0) {
            res.status(404).json({ error: { code: 'SHOP_NOT_FOUND' } });
            return;
        }
    }
    
    const [shops] = await db.query('SELECT * FROM Shop WHERE id = ?', [String(req.params.id)]);
    res.json(shops[0]);
});
