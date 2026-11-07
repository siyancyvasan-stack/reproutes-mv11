import { Router } from 'express';
import { DispatchStatus, FactoryMemberStatus, OrderStatus, ProductionStatus, Role, StockMovementType, } from '../../lib/enums.js';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { dashboardDateRange } from '../../lib/dateRange.js';
import { randomUUID } from 'node:crypto';

export const factoryRouter = Router();
factoryRouter.use(authenticate, authorize(Role.FACTORY_MANAGER));

const paging = (query) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    return { page, limit, skip: (page - 1) * limit };
};

const pagination = (page, limit, total) => ({
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
});

const emitFactory = (req, event, payload) => {
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit(event, payload);
};

const createAudit = async (connection, input) => {
    await connection.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [input.tenantId, input.actorId, input.action, input.entity, input.entityId, JSON.stringify({ oldValue: input.oldValue, newValue: input.newValue })]
    );
};

factoryRouter.get('/dashboard', async (req, res) => {
    const tenantId = req.auth.tenantId;
    const { from: rangeStart, to: rangeEnd } = dashboardDateRange(req.query, 0);

    const [
        [ordersByStatus], [productionRows], [[lowStockRow]], [[activeSalespersonsRow]], [[activeMembersRow]], [recentOrdersRows]
    ] = await Promise.all([
        db.query('SELECT status, COUNT(*) as count FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ? GROUP BY status ORDER BY status ASC', [tenantId, rangeStart, rangeEnd]),
        db.query('SELECT producedQuantity, targetQuantity, rejectedQuantity, damagedQuantity, status, createdAt, expectedFinishAt FROM ProductionOrder WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, rangeStart, rangeEnd]),
        db.query('SELECT COUNT(*) as c FROM Product WHERE tenantId = ? AND active = ? AND stockCases <= 20', [tenantId, true]), // assuming 20 as default minimumStockLevel
        db.query('SELECT COUNT(*) as c FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE u.tenantId = ? AND u.role = ? AND p.status IN (?, ?)', [tenantId, Role.AGENT, 'ACTIVE', 'ON_BREAK']),
        db.query('SELECT COUNT(*) as c FROM FactoryMember WHERE tenantId = ? AND status IN (?, ?)', [tenantId, FactoryMemberStatus.WORKING, FactoryMemberStatus.ON_BREAK]),
        db.query('SELECT o.*, u.id as u_id, u.name as u_name FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ? AND o.createdAt >= ? AND o.createdAt <= ? ORDER BY o.createdAt DESC LIMIT 8', [tenantId, rangeStart, rangeEnd]),
    ]);
    
    let recentOrders = recentOrdersRows.map(o => ({ ...o, agent: { id: o.u_id, name: o.u_name }, items: [] }));
    if (recentOrders.length > 0) {
        const orderIds = recentOrders.map(o => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        const [items] = await db.query(`SELECT i.*, p.id as p_id, p.name as p_name, p.sku as p_sku FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId IN (${placeholders})`, orderIds);
        
        const itemsMap = new Map();
        items.forEach(i => {
            if (!itemsMap.has(i.orderId)) itemsMap.set(i.orderId, []);
            itemsMap.get(i.orderId).push({ ...i, product: { id: i.p_id, name: i.p_name, sku: i.p_sku } });
        });
        
        recentOrders.forEach(o => { o.items = itemsMap.get(o.id) ?? []; });
    }

    const count = (status) => {
        const row = ordersByStatus.find((item) => item.status === status);
        return row ? row.count : 0;
    };
    const produced = productionRows.reduce((sum, row) => sum + row.producedQuantity, 0);
    
    res.json({
        kpis: {
            todayProduction: produced,
            pendingOrders: count(OrderStatus.PENDING) + count(OrderStatus.APPROVED),
            inProduction: count(OrderStatus.IN_PRODUCTION),
            readyToDispatch: count(OrderStatus.READY),
            lowStockItems: lowStockRow.c,
            delayedOrders: productionRows.filter((row) => row.status !== ProductionStatus.COMPLETED && row.status !== ProductionStatus.REJECTED && new Date(row.expectedFinishAt) < new Date()).length,
            activeSalespersons: activeSalespersonsRow.c,
            activeFactoryMembers: activeMembersRow.c,
        },
        production: {
            selectedRange: produced,
            daily: produced,
            weekly: produced,
            monthly: produced,
            target: productionRows.reduce((sum, row) => sum + row.targetQuantity, 0),
            completed: productionRows.reduce((sum, row) => sum + row.producedQuantity, 0),
            rejected: productionRows.reduce((sum, row) => sum + row.rejectedQuantity, 0),
            damaged: productionRows.reduce((sum, row) => sum + row.damagedQuantity, 0),
        },
        recentOrders,
        range: { from: rangeStart, to: rangeEnd },
        lastUpdatedAt: new Date(),
    });
});

factoryRouter.get('/orders', async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const search = String(req.query.search ?? '').trim();
    const status = z.nativeEnum(OrderStatus).safeParse(req.query.status).success ? req.query.status : undefined;
    
    let q = 'SELECT o.*, u.id as u_id, u.name as u_name FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ?';
    let countQ = 'SELECT COUNT(*) as c FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ?';
    const p = [req.auth.tenantId];
    
    if (status) {
        q += ' AND o.status = ?';
        countQ += ' AND o.status = ?';
        p.push(status);
    }
    
    if (search) {
        q += ' AND (o.id LIKE ? OR o.shopName LIKE ? OR u.name LIKE ?)';
        countQ += ' AND (o.id LIKE ? OR o.shopName LIKE ? OR u.name LIKE ?)';
        p.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    q += ' ORDER BY o.createdAt DESC LIMIT ? OFFSET ?';
    const pWithLimit = [...p, limit, skip];
    
    const [[rows], [[countRow]]] = await Promise.all([
        db.query(q, pWithLimit),
        db.query(countQ, p)
    ]);
    
    let items = rows.map(o => ({ ...o, agent: o.u_id ? { id: o.u_id, name: o.u_name } : null, items: [], productionOrders: [], dispatches: [] }));
    if (items.length > 0) {
        const orderIds = items.map(o => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        
        const [[orderItems], [prodOrders], [dispatches]] = await Promise.all([
            db.query(`SELECT i.*, p.id as p_id, p.name as p_name, p.sku as p_sku FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId IN (${placeholders})`, orderIds),
            db.query(`SELECT * FROM ProductionOrder WHERE salesOrderId IN (${placeholders})`, orderIds),
            db.query(`SELECT * FROM Dispatch WHERE orderId IN (${placeholders})`, orderIds)
        ]);
        
        const itemsMap = new Map();
        orderItems.forEach(i => {
            if (!itemsMap.has(i.orderId)) itemsMap.set(i.orderId, []);
            itemsMap.get(i.orderId).push({ ...i, product: { id: i.p_id, name: i.p_name, sku: i.p_sku } });
        });
        
        const prodMap = new Map();
        prodOrders.forEach(po => {
            if (!prodMap.has(po.salesOrderId)) prodMap.set(po.salesOrderId, []);
            prodMap.get(po.salesOrderId).push(po);
        });
        
        const dispatchMap = new Map();
        dispatches.forEach(d => {
            if (!dispatchMap.has(d.orderId)) dispatchMap.set(d.orderId, []);
            dispatchMap.get(d.orderId).push(d);
        });
        
        items.forEach(o => {
            o.items = itemsMap.get(o.id) ?? [];
            o.productionOrders = prodMap.get(o.id) ?? [];
            o.dispatches = dispatchMap.get(o.id) ?? [];
        });
    }

    res.json({ items, pagination: pagination(page, limit, countRow.c) });
});

factoryRouter.patch('/orders/:id/status', async (req, res) => {
    const { status, expectedReadyAt } = z.object({
        status: z.enum(['PRODUCTION_REQUIRED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED']),
        expectedReadyAt: z.string().datetime().optional(),
    }).parse(req.body);
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const [orders] = await db.query('SELECT * FROM `Order` WHERE id = ? AND tenantId = ?', [id, tenantId]);
    const order = orders[0];
    
    if (!order)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        const expected = expectedReadyAt ? new Date(expectedReadyAt) : null;
        await connection.query('UPDATE `Order` SET status = ?, expectedReadyAt = ? WHERE id = ?', [status, expected, id]);
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'ORDER_STATUS_CHANGED', entity: 'Order', entityId: id, oldValue: { status: order.status }, newValue: { status } });
        
        const nId1 = randomUUID();
        const nId2 = randomUUID();
        await connection.query(
            'INSERT INTO Notification (id, tenantId, userId, type, title, message, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW()), (?, ?, NULL, ?, ?, ?, NOW())',
            [
                nId1, tenantId, order.agentId, status === 'READY' ? 'READY_FOR_DISPATCH' : 'ORDER_APPROVED', 'Order status updated', `${order.shopName} is now ${status.replaceAll('_', ' ')}`,
                nId2, tenantId, 'ORDER_APPROVED', 'Factory workflow updated', `${order.shopName} moved to ${status.replaceAll('_', ' ')}`
            ]
        );
        
        const [ups] = await connection.query('SELECT * FROM `Order` WHERE id = ?', [id]);
        updated = ups[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:order-updated', updated);
    return res.json(updated);
});

const productInput = z.object({
    name: z.string().min(2).max(150),
    sku: z.string().min(2).max(60).transform((value) => value.trim().toUpperCase()),
    category: z.string().min(2).max(80),
    description: z.string().max(2000).optional(),
    imageUrl: z.string().url().optional().or(z.literal('')),
    pricePerCaseLkr: z.coerce.number().nonnegative(),
    unitsPerCase: z.coerce.number().int().positive(),
    stockCases: z.coerce.number().int().nonnegative(),
    reservedStock: z.coerce.number().int().nonnegative().default(0),
    productionCapacity: z.coerce.number().int().nonnegative().default(0),
    minimumStockLevel: z.coerce.number().int().nonnegative().default(20),
    unitType: z.string().min(1).max(30).default('CASE'),
    active: z.boolean().default(true),
});

factoryRouter.get('/products', async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const search = String(req.query.search ?? '').trim();
    
    let q = 'SELECT * FROM Product WHERE tenantId = ? AND active = ?';
    let countQ = 'SELECT COUNT(*) as c FROM Product WHERE tenantId = ? AND active = ?';
    const p = [req.auth.tenantId, true];
    
    if (search) {
        q += ' AND (name LIKE ? OR sku LIKE ?)';
        countQ += ' AND (name LIKE ? OR sku LIKE ?)';
        p.push(`%${search}%`, `%${search}%`);
    }
    
    q += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    const pWithLimit = [...p, limit, skip];
    
    const [[rows], [[countRow]]] = await Promise.all([
        db.query(q, pWithLimit),
        db.query(countQ, p)
    ]);
    
    let items = rows.map(r => ({ ...r, productionOrders: [] }));
    if (items.length > 0) {
        const pIds = items.map(i => i.id);
        const placeholders = pIds.map(() => '?').join(',');
        
        const [prodOrders] = await db.query(
            `SELECT productId, requiredQuantity, producedQuantity FROM ProductionOrder WHERE productId IN (${placeholders}) AND status IN (?, ?, ?, ?)`,
            [...pIds, ProductionStatus.WAITING, ProductionStatus.IN_PROGRESS, ProductionStatus.PAUSED, ProductionStatus.QUALITY_CHECK]
        );
        
        const prodMap = new Map();
        prodOrders.forEach(po => {
            if (!prodMap.has(po.productId)) prodMap.set(po.productId, []);
            prodMap.get(po.productId).push(po);
        });
        
        items.forEach(i => { i.productionOrders = prodMap.get(i.id) ?? []; });
    }
    
    items = items.map((item) => ({ ...item, pendingProductionQuantity: item.productionOrders.reduce((sum, row) => sum + Math.max(0, row.requiredQuantity - row.producedQuantity), 0) }));
    
    res.json({ items, pagination: pagination(page, limit, countRow.c) });
});

factoryRouter.post('/products', async (req, res) => {
    const input = productInput.parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const [dupes] = await db.query('SELECT id FROM Product WHERE tenantId = ? AND sku = ?', [tenantId, input.sku]);
    if (dupes.length > 0)
        return res.status(409).json({ error: { code: 'DUPLICATE_SKU', message: 'A product with this SKU already exists' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let created;
    try {
        const id = randomUUID();
        await connection.query(
            'INSERT INTO Product (id, tenantId, name, sku, category, description, imageUrl, pricePerCaseLkr, unitsPerCase, stockCases, reservedStock, productionCapacity, minimumStockLevel, unitType, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [id, tenantId, input.name, input.sku, input.category, input.description || null, input.imageUrl || null, input.pricePerCaseLkr, input.unitsPerCase, input.stockCases, input.reservedStock, input.productionCapacity, input.minimumStockLevel, input.unitType, input.active]
        );
        
        const [rows] = await connection.query('SELECT * FROM Product WHERE id = ?', [id]);
        created = rows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'PRODUCT_CREATED', entity: 'Product', entityId: id, newValue: created });
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:product-updated', created);
    return res.status(201).json(created);
});

factoryRouter.patch('/products/:id', async (req, res) => {
    const input = productInput.partial().parse(req.body);
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const [currentRows] = await db.query('SELECT * FROM Product WHERE id = ? AND tenantId = ?', [id, tenantId]);
    if (currentRows.length === 0)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    const current = currentRows[0];
        
    if (input.sku) {
        const [dupes] = await db.query('SELECT id FROM Product WHERE tenantId = ? AND sku = ? AND id != ?', [tenantId, input.sku, id]);
        if (dupes.length > 0)
            return res.status(409).json({ error: { code: 'DUPLICATE_SKU', message: 'A product with this SKU already exists' } });
    }
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        const updates = [];
        const params = [];
        for (const [key, value] of Object.entries(input)) {
            if (value !== undefined) {
                updates.push(`${key} = ?`);
                params.push(key === 'imageUrl' && !value ? null : value);
            }
        }
        if (updates.length > 0) {
            updates.push('updatedAt = NOW()');
            await connection.query(`UPDATE Product SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
        }
        
        const [rows] = await connection.query('SELECT * FROM Product WHERE id = ?', [id]);
        updated = rows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'PRODUCT_EDITED', entity: 'Product', entityId: id, oldValue: current, newValue: updated });
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:product-updated', updated);
    return res.json(updated);
});

factoryRouter.delete('/products/:id', async (req, res) => {
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const [currentRows] = await db.query('SELECT * FROM Product WHERE id = ? AND tenantId = ? AND active = ?', [id, tenantId, true]);
    if (currentRows.length === 0)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    const current = currentRows[0];
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('UPDATE Product SET active = ?, updatedAt = NOW() WHERE id = ?', [false, id]);
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'PRODUCT_DELETED', entity: 'Product', entityId: id, oldValue: current, newValue: { active: false } });
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:product-updated', { id, deleted: true });
    return res.status(204).send();
});

factoryRouter.get('/inventory', async (req, res) => {
    const tenantId = req.auth.tenantId;
    const [[finishedGoods], [rawMaterials], [movementsRows]] = await Promise.all([
        db.query('SELECT * FROM Product WHERE tenantId = ? ORDER BY name ASC', [tenantId]),
        db.query('SELECT * FROM RawMaterial WHERE tenantId = ? ORDER BY name ASC', [tenantId]),
        db.query('SELECT m.*, p.name as p_name, p.sku as p_sku FROM InventoryMovement m JOIN Product p ON m.productId = p.id WHERE m.tenantId = ? ORDER BY m.createdAt DESC LIMIT 50', [tenantId]),
    ]);
    
    const movements = movementsRows.map(m => ({ ...m, product: { name: m.p_name, sku: m.p_sku } }));
    
    res.json({
        finishedGoods: finishedGoods.map((product) => ({ ...product, availableQuantity: Math.max(0, product.stockCases - product.reservedStock), stockStatus: product.stockCases <= 0 ? 'CRITICAL' : product.stockCases <= product.minimumStockLevel ? 'LOW' : 'GOOD' })),
        rawMaterials: rawMaterials.map((material) => ({ ...material, reorderStatus: material.currentQuantity <= 0 ? 'CRITICAL' : material.currentQuantity <= material.minimumStock ? 'LOW' : 'GOOD' })),
        movements,
    });
});

factoryRouter.post('/inventory/adjust', async (req, res) => {
    const input = z.object({ productId: z.string(), type: z.nativeEnum(StockMovementType), quantity: z.number().int().positive(), notes: z.string().max(500).optional() }).parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let result = null;
    try {
        const [products] = await connection.query('SELECT * FROM Product WHERE id = ? AND tenantId = ?', [input.productId, tenantId]);
        const product = products[0];
        
        if (!product) throw new Error('PRODUCT_NOT_FOUND');
        
        const subtract = input.type === StockMovementType.STOCK_OUT || input.type === StockMovementType.DAMAGE;
        const nextStock = product.stockCases + (subtract ? -input.quantity : input.type === StockMovementType.STOCK_IN ? input.quantity : 0);
        const nextReserved = product.reservedStock + (input.type === StockMovementType.RESERVE ? input.quantity : input.type === StockMovementType.RELEASE ? -input.quantity : 0);
        
        if (nextStock < 0 || nextReserved < 0 || nextReserved > nextStock)
            throw new Error('INVALID_STOCK_BALANCE');
            
        let damagedUpdate = '';
        const params = [nextStock, nextReserved];
        if (input.type === StockMovementType.DAMAGE) {
            damagedUpdate = ', damagedStock = damagedStock + ?';
            params.push(input.quantity);
        }
        
        await connection.query(`UPDATE Product SET stockCases = ?, reservedStock = ? ${damagedUpdate} WHERE id = ?`, [...params, product.id]);
        
        const [updatedRows] = await connection.query('SELECT * FROM Product WHERE id = ?', [product.id]);
        const updated = updatedRows[0];
        
        const mId = randomUUID();
        await connection.query(
            'INSERT INTO InventoryMovement (id, tenantId, productId, type, quantity, balanceAfter, notes, actorId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [mId, tenantId, product.id, input.type, input.quantity, nextStock, input.notes || null, req.auth.sub]
        );
        const [mRows] = await connection.query('SELECT * FROM InventoryMovement WHERE id = ?', [mId]);
        const movement = mRows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'STOCK_CHANGED', entity: 'Product', entityId: product.id, oldValue: { stockCases: product.stockCases, reservedStock: product.reservedStock }, newValue: { stockCases: nextStock, reservedStock: nextReserved } });
        
        if (nextStock <= product.minimumStockLevel) {
            await connection.query(
                'INSERT INTO Notification (id, tenantId, userId, type, title, message, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
                [tenantId, req.auth.sub, 'LOW_STOCK', 'Low stock alert', `${product.name} has ${nextStock} ${product.unitType.toLowerCase()} remaining`]
            );
        }
        
        result = { product: updated, movement };
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        if (error instanceof Error && ['PRODUCT_NOT_FOUND', 'INVALID_STOCK_BALANCE'].includes(error.message)) {
            result = null;
        } else {
            connection.release();
            throw error;
        }
    } finally {
        connection.release();
    }
    
    if (!result)
        return res.status(422).json({ error: { code: 'INVALID_STOCK', message: 'Stock adjustment would create an invalid balance' } });
        
    emitFactory(req, 'factory:inventory-updated', result);
    return res.status(201).json(result);
});

const materialInput = z.object({ name: z.string().min(2), sku: z.string().min(2).transform((value) => value.toUpperCase()), currentQuantity: z.coerce.number().nonnegative(), minimumStock: z.coerce.number().nonnegative(), unitType: z.string().min(1), supplier: z.string().optional(), active: z.boolean().default(true) });

factoryRouter.post('/raw-materials', async (req, res) => {
    const input = materialInput.parse(req.body);
    const id = randomUUID();
    await db.query(
        'INSERT INTO RawMaterial (id, tenantId, name, sku, currentQuantity, minimumStock, unitType, supplier, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, req.auth.tenantId, input.name, input.sku, input.currentQuantity, input.minimumStock, input.unitType, input.supplier || null, input.active]
    );
    const [rows] = await db.query('SELECT * FROM RawMaterial WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
});

factoryRouter.patch('/raw-materials/:id', async (req, res) => {
    const input = materialInput.partial().parse(req.body);
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
            updates.push(`${key} = ?`);
            params.push(value);
        }
    }
    if (updates.length > 0) {
        updates.push('updatedAt = NOW()');
        const [result] = await db.query(`UPDATE RawMaterial SET ${updates.join(', ')} WHERE id = ? AND tenantId = ?`, [...params, req.params.id, req.auth.tenantId]);
        if (result.affectedRows === 0)
            return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    }
    const [rows] = await db.query('SELECT * FROM RawMaterial WHERE id = ?', [req.params.id]);
    return res.json(rows[0]);
});

factoryRouter.get('/production', async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const status = z.nativeEnum(ProductionStatus).safeParse(req.query.status).success ? req.query.status : undefined;
    
    let q = 'SELECT po.*, p.id as p_id, p.name as p_name, p.sku as p_sku, so.id as so_id, so.createdAt as so_createdAt, so.shopName as so_shopName, u.name as u_name FROM ProductionOrder po JOIN Product p ON po.productId = p.id LEFT JOIN `Order` so ON po.salesOrderId = so.id LEFT JOIN User u ON so.agentId = u.id WHERE po.tenantId = ?';
    let countQ = 'SELECT COUNT(*) as c FROM ProductionOrder WHERE tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (status) {
        q += ' AND po.status = ?';
        countQ += ' AND status = ?';
        params.push(status);
    }
    
    q += ' ORDER BY po.createdAt DESC LIMIT ? OFFSET ?';
    const pWithLimit = [...params, limit, skip];
    
    const [[rows], [[countRow]]] = await Promise.all([
        db.query(q, pWithLimit),
        db.query(countQ, params)
    ]);
    
    let items = rows.map(r => ({
        ...r,
        product: { id: r.p_id, name: r.p_name, sku: r.p_sku },
        salesOrder: r.so_id ? { id: r.so_id, createdAt: r.so_createdAt, shopName: r.so_shopName, agent: r.u_name ? { name: r.u_name } : null } : null,
        tasks: []
    }));
    
    if (items.length > 0) {
        const poIds = items.map(i => i.id);
        const placeholders = poIds.map(() => '?').join(',');
        const [tasks] = await db.query(`SELECT t.*, m.id as m_id, m.name as m_name FROM ProductionTask t JOIN FactoryMember m ON t.factoryMemberId = m.id WHERE t.productionOrderId IN (${placeholders})`, poIds);
        
        const tasksMap = new Map();
        tasks.forEach(t => {
            if (!tasksMap.has(t.productionOrderId)) tasksMap.set(t.productionOrderId, []);
            tasksMap.get(t.productionOrderId).push({ ...t, factoryMember: { id: t.m_id, name: t.m_name } });
        });
        
        items.forEach(i => { i.tasks = tasksMap.get(i.id) ?? []; });
    }
    
    res.json({ items, pagination: pagination(page, limit, countRow.c) });
});

const productionInput = z.object({ salesOrderId: z.string().optional(), productId: z.string(), requiredQuantity: z.number().int().positive(), targetQuantity: z.number().int().positive().optional(), expectedFinishAt: z.string().datetime(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), notes: z.string().max(1000).optional(), memberIds: z.array(z.string()).default([]) });

factoryRouter.post('/production', async (req, res) => {
    const input = productionInput.parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let created;
    try {
        const [products] = await connection.query('SELECT name FROM Product WHERE id = ? AND tenantId = ?', [input.productId, tenantId]);
        if (products.length === 0) throw new Error('INVALID_PRODUCT');
        const product = products[0];
        
        if (input.salesOrderId) {
            const [orders] = await connection.query('SELECT id FROM `Order` WHERE id = ? AND tenantId = ?', [input.salesOrderId, tenantId]);
            if (orders.length === 0) throw new Error('INVALID_ORDER');
        }
        
        const poId = randomUUID();
        await connection.query(
            'INSERT INTO ProductionOrder (id, tenantId, salesOrderId, productId, requiredQuantity, targetQuantity, expectedFinishAt, priority, notes, managerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [poId, tenantId, input.salesOrderId || null, input.productId, input.requiredQuantity, input.targetQuantity ?? input.requiredQuantity, new Date(input.expectedFinishAt), input.priority, input.notes || null, req.auth.sub]
        );
        
        if (input.memberIds.length > 0) {
            const placeholders = input.memberIds.map(() => '?').join(',');
            const [members] = await connection.query(`SELECT id FROM FactoryMember WHERE tenantId = ? AND id IN (${placeholders})`, [tenantId, ...input.memberIds]);
            
            for (const member of members) {
                await connection.query(
                    'INSERT INTO ProductionTask (id, tenantId, productionOrderId, factoryMemberId, title, priority, assignedAt) VALUES (?, ?, ?, ?, ?, NOW())',
                    [tenantId, poId, member.id, `Produce ${product.name}`, input.priority]
                );
                await connection.query(
                    'UPDATE FactoryMember SET workload = workload + 1, currentTask = ? WHERE id = ?',
                    [`Produce ${product.name}`, member.id]
                );
            }
        }
        
        if (input.salesOrderId) {
            await connection.query('UPDATE `Order` SET status = ? WHERE id = ?', [OrderStatus.PRODUCTION_REQUIRED, input.salesOrderId]);
        }
        
        const [rows] = await connection.query('SELECT * FROM ProductionOrder WHERE id = ?', [poId]);
        created = rows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'PRODUCTION_CREATED', entity: 'ProductionOrder', entityId: poId, newValue: created });
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:production-updated', created);
    return res.status(201).json(created);
});

factoryRouter.patch('/production/:id', async (req, res) => {
    const input = z.object({ producedQuantity: z.number().int().nonnegative().optional(), rejectedQuantity: z.number().int().nonnegative().optional(), damagedQuantity: z.number().int().nonnegative().optional(), status: z.nativeEnum(ProductionStatus).optional(), notes: z.string().max(1000).optional() }).parse(req.body);
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let result;
    try {
        const [currentRows] = await connection.query('SELECT po.*, p.name as product_name FROM ProductionOrder po JOIN Product p ON po.productId = p.id WHERE po.id = ? AND po.tenantId = ?', [id, tenantId]);
        if (currentRows.length === 0) throw new Error('NOT_FOUND');
        const current = currentRows[0];
        
        if (current.status === ProductionStatus.COMPLETED && input.status === ProductionStatus.COMPLETED)
            throw new Error('ALREADY_COMPLETED');
            
        const producedQuantity = input.producedQuantity ?? current.producedQuantity;
        if (producedQuantity > current.requiredQuantity)
            throw new Error('EXCEEDS_REQUIRED');
            
        const completing = input.status === ProductionStatus.COMPLETED;
        
        const updates = [];
        const params = [];
        
        if (input.producedQuantity !== undefined) { updates.push('producedQuantity = ?'); params.push(input.producedQuantity); }
        if (input.rejectedQuantity !== undefined) { updates.push('rejectedQuantity = ?'); params.push(input.rejectedQuantity); }
        if (input.damagedQuantity !== undefined) { updates.push('damagedQuantity = ?'); params.push(input.damagedQuantity); }
        if (input.status !== undefined) { updates.push('status = ?'); params.push(input.status); }
        if (input.notes !== undefined) { updates.push('notes = ?'); params.push(input.notes); }
        
        if (input.status === ProductionStatus.IN_PROGRESS && !current.startDate) {
            updates.push('startDate = NOW()');
        }
        if (completing) {
            updates.push('completedAt = NOW()');
        }
        
        updates.push('updatedAt = NOW()');
        
        await connection.query(`UPDATE ProductionOrder SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
        
        if (current.salesOrderId && input.status) {
            const orderStatus = input.status === ProductionStatus.IN_PROGRESS ? OrderStatus.IN_PRODUCTION : input.status === ProductionStatus.QUALITY_CHECK ? OrderStatus.QUALITY_CHECK : completing ? OrderStatus.READY : undefined;
            if (orderStatus) {
                await connection.query('UPDATE `Order` SET status = ? WHERE id = ?', [orderStatus, current.salesOrderId]);
            }
        }
        
        if (completing) {
            await connection.query('UPDATE Product SET stockCases = stockCases + ? WHERE id = ?', [producedQuantity, current.productId]);
            const [pRows] = await connection.query('SELECT stockCases FROM Product WHERE id = ?', [current.productId]);
            const updatedStock = pRows[0].stockCases;
            
            await connection.query(
                'INSERT INTO InventoryMovement (id, tenantId, productId, type, quantity, balanceAfter, referenceType, referenceId, actorId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [tenantId, current.productId, StockMovementType.STOCK_IN, producedQuantity, updatedStock, 'ProductionOrder', id, req.auth.sub]
            );
            
            await connection.query(
                'INSERT INTO Notification (id, tenantId, type, title, message, createdAt) VALUES (?, ?, ?, ?, NOW())',
                [tenantId, 'PRODUCTION_COMPLETE', 'Production completed', `${producedQuantity} units of ${current.product_name} completed`]
            );
        }
        
        const [updatedRows] = await connection.query('SELECT * FROM ProductionOrder WHERE id = ?', [id]);
        const updated = updatedRows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: completing ? 'PRODUCTION_COMPLETED' : 'PRODUCTION_UPDATED', entity: 'ProductionOrder', entityId: id, oldValue: current, newValue: updated });
        
        result = updated;
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        if (error instanceof Error && ['NOT_FOUND', 'ALREADY_COMPLETED', 'EXCEEDS_REQUIRED'].includes(error.message)) {
            result = { error: error.message };
        } else {
            connection.release();
            throw error;
        }
    } finally {
        connection.release();
    }
    
    if ('error' in result)
        return res.status(result.error === 'NOT_FOUND' ? 404 : 409).json({ error: { code: result.error } });
        
    emitFactory(req, 'factory:production-updated', result);
    return res.json(result);
});

factoryRouter.get('/members', async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const search = String(req.query.search ?? '').trim();
    
    let q = 'SELECT * FROM FactoryMember WHERE tenantId = ? AND active = ?';
    let countQ = 'SELECT COUNT(*) as c FROM FactoryMember WHERE tenantId = ? AND active = ?';
    const params = [req.auth.tenantId, true];
    
    if (search) {
        q += ' AND (name LIKE ? OR employeeId LIKE ? OR department LIKE ?)';
        countQ += ' AND (name LIKE ? OR employeeId LIKE ? OR department LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    q += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    const pWithLimit = [...params, limit, skip];
    
    const [[rows], [[countRow]]] = await Promise.all([
        db.query(q, pWithLimit),
        db.query(countQ, params)
    ]);
    
    let items = rows.map(r => ({ ...r, tasks: [], attendance: [] }));
    
    if (items.length > 0) {
        const mIds = items.map(i => i.id);
        const placeholders = mIds.map(() => '?').join(',');
        
        const [[tasks], [attendances]] = await Promise.all([
            // Since we need max 10 tasks per member, a naive fetch and filter is used (or just fetch all if small, but here we just fetch recent tasks)
            db.query(`SELECT * FROM ProductionTask WHERE factoryMemberId IN (${placeholders}) ORDER BY assignedAt DESC`, mIds),
            db.query(`SELECT * FROM FactoryAttendance WHERE memberId IN (${placeholders}) ORDER BY date DESC`, mIds)
        ]);
        
        const tasksMap = new Map();
        tasks.forEach(t => {
            if (!tasksMap.has(t.factoryMemberId)) tasksMap.set(t.factoryMemberId, []);
            if (tasksMap.get(t.factoryMemberId).length < 10) tasksMap.get(t.factoryMemberId).push(t);
        });
        
        const attMap = new Map();
        attendances.forEach(a => {
            if (!attMap.has(a.memberId)) attMap.set(a.memberId, []);
            if (attMap.get(a.memberId).length < 1) attMap.get(a.memberId).push(a);
        });
        
        items.forEach(i => {
            i.tasks = tasksMap.get(i.id) ?? [];
            i.attendance = attMap.get(i.id) ?? [];
        });
    }
    
    res.json({ items, pagination: pagination(page, limit, countRow.c) });
});

const memberInput = z.object({ name: z.string().min(2), employeeId: z.string().min(2).transform((value) => value.toUpperCase()), profileImage: z.string().url().optional().or(z.literal('')), phone: z.string().max(30).optional(), department: z.string().min(2), status: z.nativeEnum(FactoryMemberStatus).default(FactoryMemberStatus.OFF_SHIFT), currentTask: z.string().max(300).optional() });

factoryRouter.post('/members', async (req, res) => {
    const input = memberInput.parse(req.body);
    const id = randomUUID();
    await db.query(
        'INSERT INTO FactoryMember (id, tenantId, name, employeeId, profileImage, phone, department, status, currentTask, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, req.auth.tenantId, input.name, input.employeeId, input.profileImage || null, input.phone || null, input.department, input.status, input.currentTask || null, true]
    );
    const [rows] = await db.query('SELECT * FROM FactoryMember WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
});

factoryRouter.patch('/members/:id', async (req, res) => {
    const input = memberInput.partial().parse(req.body);
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
            updates.push(`${key} = ?`);
            params.push(key === 'profileImage' && !value ? null : value);
        }
    }
    if (updates.length > 0) {
        updates.push('updatedAt = NOW()');
        const [result] = await db.query(`UPDATE FactoryMember SET ${updates.join(', ')} WHERE id = ? AND tenantId = ?`, [...params, req.params.id, req.auth.tenantId]);
        if (result.affectedRows === 0)
            return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    }
    const [rows] = await db.query('SELECT * FROM FactoryMember WHERE id = ?', [req.params.id]);
    return res.json(rows[0]);
});

factoryRouter.delete('/members/:id', async (req, res) => {
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const [members] = await db.query('SELECT * FROM FactoryMember WHERE id = ? AND tenantId = ? AND active = ?', [id, tenantId, true]);
    const member = members[0];
    if (!member)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('UPDATE FactoryMember SET active = ?, status = ?, currentTask = NULL, workload = 0, updatedAt = NOW() WHERE id = ?', [false, FactoryMemberStatus.OFF_SHIFT, id]);
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'FACTORY_MEMBER_DELETED', entity: 'FactoryMember', entityId: id, oldValue: member, newValue: { active: false } });
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:member-updated', { id, deleted: true });
    return res.status(204).send();
});

factoryRouter.post('/members/:id/attendance', async (req, res) => {
    const { action } = z.object({ action: z.enum(['PUNCH_IN', 'BREAK_START', 'BREAK_END', 'PUNCH_OUT']) }).parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const [members] = await db.query('SELECT id FROM FactoryMember WHERE id = ? AND tenantId = ?', [req.params.id, tenantId]);
    const member = members[0];
    if (!member)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
        
    const now = new Date();
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0); // Need consistent date boundary
    
    const [attRows] = await db.query('SELECT * FROM FactoryAttendance WHERE memberId = ? AND date = ?', [member.id, date]);
    const current = attRows[0];
    
    if (action === 'PUNCH_IN') {
        if (current)
            return res.status(409).json({ error: { code: 'ALREADY_PUNCHED_IN' } });
            
        const attId = randomUUID();
        await db.query('INSERT INTO FactoryAttendance (id, tenantId, memberId, date, punchInAt) VALUES (?, ?, ?, ?, ?)', [attId, tenantId, member.id, date, now]);
        await db.query('UPDATE FactoryMember SET status = ? WHERE id = ?', [FactoryMemberStatus.WORKING, member.id]);
        
        const [rows] = await db.query('SELECT * FROM FactoryAttendance WHERE id = ?', [attId]);
        return res.status(201).json(rows[0]);
    }
    
    if (!current || current.punchOutAt)
        return res.status(409).json({ error: { code: 'NO_ACTIVE_SHIFT' } });
        
    if (action === 'BREAK_START') {
        if (current.breakStartedAt)
            return res.status(409).json({ error: { code: 'BREAK_ACTIVE' } });
            
        await db.query('UPDATE FactoryMember SET status = ? WHERE id = ?', [FactoryMemberStatus.ON_BREAK, member.id]);
        await db.query('UPDATE FactoryAttendance SET breakStartedAt = ? WHERE id = ?', [now, current.id]);
        
        const [rows] = await db.query('SELECT * FROM FactoryAttendance WHERE id = ?', [current.id]);
        return res.json(rows[0]);
    }
    
    if (action === 'BREAK_END') {
        if (!current.breakStartedAt)
            return res.status(409).json({ error: { code: 'NO_ACTIVE_BREAK' } });
            
        const minutes = Math.max(1, Math.round((now.getTime() - new Date(current.breakStartedAt).getTime()) / 60_000));
        await db.query('UPDATE FactoryMember SET status = ? WHERE id = ?', [FactoryMemberStatus.WORKING, member.id]);
        await db.query('UPDATE FactoryAttendance SET breakStartedAt = NULL, breakMinutes = breakMinutes + ? WHERE id = ?', [minutes, current.id]);
        
        const [rows] = await db.query('SELECT * FROM FactoryAttendance WHERE id = ?', [current.id]);
        return res.json(rows[0]);
    }
    
    await db.query('UPDATE FactoryMember SET status = ? WHERE id = ?', [FactoryMemberStatus.OFF_SHIFT, member.id]);
    await db.query('UPDATE FactoryAttendance SET punchOutAt = ?, breakStartedAt = NULL WHERE id = ?', [now, current.id]);
    
    const [rows] = await db.query('SELECT * FROM FactoryAttendance WHERE id = ?', [current.id]);
    return res.json(rows[0]);
});

factoryRouter.get('/dispatches', async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const status = z.nativeEnum(DispatchStatus).safeParse(req.query.status).success ? req.query.status : undefined;
    
    let q = 'SELECT d.*, p.id as p_id, p.name as p_name, o.id as o_id, u.id as u_id, u.name as u_name, u.avatarUrl as u_avatarUrl, ap.id as ap_id FROM Dispatch d LEFT JOIN Product p ON d.productId = p.id LEFT JOIN `Order` o ON d.orderId = o.id LEFT JOIN User u ON d.salespersonId = u.id LEFT JOIN AgentProfile ap ON u.id = ap.userId WHERE d.tenantId = ?';
    let countQ = 'SELECT COUNT(*) as c FROM Dispatch WHERE tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (status) {
        q += ' AND d.status = ?';
        countQ += ' AND status = ?';
        params.push(status);
    }
    
    q += ' ORDER BY d.createdAt DESC LIMIT ? OFFSET ?';
    const pWithLimit = [...params, limit, skip];
    
    const [[rows], [[countRow]]] = await Promise.all([
        db.query(q, pWithLimit),
        db.query(countQ, params)
    ]);
    
    const items = rows.map(r => ({
        ...r,
        product: r.p_id ? { id: r.p_id, name: r.p_name } : null,
        order: r.o_id ? { id: r.o_id } : null,
        salesperson: r.u_id ? { id: r.u_id, name: r.u_name, avatarUrl: r.u_avatarUrl, agentProfile: r.ap_id ? { id: r.ap_id } : null } : null
    }));
    
    res.json({ items, pagination: pagination(page, limit, countRow.c) });
});

factoryRouter.post('/dispatches', async (req, res) => {
    const input = z.object({ orderId: z.string(), productId: z.string(), quantity: z.number().int().positive(), salespersonId: z.string(), factoryLocation: z.string().min(2), destination: z.string().min(2) }).parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let result;
    try {
        const [[orders], [products], [salespersons]] = await Promise.all([
            connection.query('SELECT id FROM `Order` WHERE id = ? AND tenantId = ?', [input.orderId, tenantId]),
            connection.query('SELECT * FROM Product WHERE id = ? AND tenantId = ?', [input.productId, tenantId]),
            connection.query('SELECT id, name FROM User WHERE id = ? AND tenantId = ? AND role = ?', [input.salespersonId, tenantId, Role.AGENT]),
        ]);
        
        if (orders.length === 0 || products.length === 0 || salespersons.length === 0)
            throw new Error('INVALID_REFERENCE');
            
        const product = products[0];
        const salesperson = salespersons[0];
        const order = orders[0];
        
        if (product.stockCases - product.reservedStock < input.quantity)
            throw new Error('INSUFFICIENT_STOCK');
            
        const dId = randomUUID();
        try {
            await connection.query(
                'INSERT INTO Dispatch (id, tenantId, orderId, productId, quantity, salespersonId, factoryLocation, destination, factoryManagerId, status, dispatchedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                [dId, tenantId, input.orderId, input.productId, input.quantity, input.salespersonId, input.factoryLocation, input.destination, req.auth.sub, DispatchStatus.DISPATCHED]
            );
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') throw { code: 'P2002' };
            throw e;
        }
        
        await connection.query('UPDATE Product SET stockCases = stockCases - ? WHERE id = ?', [input.quantity, product.id]);
        
        await connection.query(
            'INSERT INTO InventoryMovement (id, tenantId, productId, type, quantity, balanceAfter, referenceType, referenceId, actorId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [tenantId, product.id, StockMovementType.STOCK_OUT, input.quantity, product.stockCases - input.quantity, 'Dispatch', dId, req.auth.sub]
        );
        
        await connection.query('UPDATE `Order` SET status = ? WHERE id = ?', [OrderStatus.DISPATCHED, order.id]);
        
        await connection.query(
            'INSERT INTO Notification (id, tenantId, userId, type, title, message, createdAt) VALUES (?, ?, ?, ?, ?, NOW()), (UUID(), ?, NULL, ?, ?, ?, NOW())',
            [
                tenantId, salesperson.id, 'DISPATCH_STARTED', 'Delivery assigned', `${input.quantity} × ${product.name} ready for delivery to ${input.destination}`,
                tenantId, 'DISPATCH_STARTED', 'Dispatch started', `${dId} assigned to ${salesperson.name}`
            ]
        );
        
        const [dRows] = await connection.query('SELECT * FROM Dispatch WHERE id = ?', [dId]);
        const created = dRows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: 'DISPATCH_CREATED', entity: 'Dispatch', entityId: dId, newValue: created });
        
        result = created;
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        if (error instanceof Error && ['INVALID_REFERENCE', 'INSUFFICIENT_STOCK'].includes(error.message)) {
            result = { error: error.message };
        } else if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
            result = { error: 'DUPLICATE_DISPATCH' };
        } else {
            connection.release();
            throw error;
        }
    } finally {
        connection.release();
    }
    
    if ('error' in result)
        return res.status(409).json({ error: { code: result.error } });
        
    emitFactory(req, 'factory:dispatch-updated', result);
    return res.status(201).json(result);
});

factoryRouter.patch('/dispatches/:id/status', async (req, res) => {
    const { status, failureReason } = z.object({ status: z.nativeEnum(DispatchStatus), failureReason: z.string().max(500).optional() }).parse(req.body);
    const tenantId = req.auth.tenantId;
    const id = String(req.params.id);
    
    const [currentRows] = await db.query('SELECT * FROM Dispatch WHERE id = ? AND tenantId = ?', [id, tenantId]);
    if (currentRows.length === 0)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    const current = currentRows[0];
        
    if (current.status === DispatchStatus.DELIVERED || current.status === DispatchStatus.FAILED)
        return res.status(409).json({ error: { code: 'DISPATCH_FINALIZED' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        const updates = ['status = ?'];
        const params = [status];
        
        if (failureReason !== undefined) { updates.push('failureReason = ?'); params.push(failureReason); }
        if (status === DispatchStatus.ARRIVED) { updates.push('arrivedAt = NOW()'); }
        if (status === DispatchStatus.DELIVERED) { updates.push('deliveredAt = NOW()'); }
        if (status === DispatchStatus.FAILED) { updates.push('failedAt = NOW()'); }
        
        await connection.query(`UPDATE Dispatch SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
        
        if (status === DispatchStatus.DELIVERED) {
            await connection.query('UPDATE `Order` SET status = ? WHERE id = ?', [OrderStatus.DELIVERED, current.orderId]);
        }
        
        const notifType = status === DispatchStatus.DELIVERED ? 'DELIVERY_COMPLETED' : status === DispatchStatus.FAILED ? 'DELIVERY_FAILED' : 'DISPATCH_STARTED';
        await connection.query(
            'INSERT INTO Notification (id, tenantId, type, title, message, createdAt) VALUES (?, ?, ?, ?, NOW())',
            [tenantId, notifType, `Dispatch ${status.replaceAll('_', ' ')}`, `${id} status changed to ${status.replaceAll('_', ' ')}`]
        );
        
        const [nextRows] = await connection.query('SELECT * FROM Dispatch WHERE id = ?', [id]);
        const next = nextRows[0];
        
        await createAudit(connection, { tenantId, actorId: req.auth.sub, action: status === DispatchStatus.DELIVERED ? 'DISPATCH_DELIVERED' : 'DISPATCH_STATUS_CHANGED', entity: 'Dispatch', entityId: id, oldValue: { status: current.status }, newValue: { status } });
        
        updated = next;
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    emitFactory(req, 'factory:dispatch-updated', updated);
    return res.json(updated);
});

factoryRouter.get('/reports', async (req, res) => {
    const tenantId = req.auth.tenantId;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    const [[productionRows], [products], [dispatchRows]] = await Promise.all([
        db.query('SELECT po.*, p.name as p_name FROM ProductionOrder po JOIN Product p ON po.productId = p.id WHERE po.tenantId = ? AND po.createdAt >= ?', [tenantId, from]),
        db.query('SELECT * FROM Product WHERE tenantId = ?', [tenantId]),
        db.query('SELECT d.*, u.id as u_id, u.name as u_name, p.name as p_name FROM Dispatch d LEFT JOIN User u ON d.salespersonId = u.id LEFT JOIN Product p ON d.productId = p.id WHERE d.tenantId = ? AND d.createdAt >= ?', [tenantId, from]),
    ]);
    
    const production = productionRows.map(r => ({ ...r, product: { name: r.p_name } }));
    const dispatches = dispatchRows.map(r => ({ ...r, salesperson: r.u_id ? { id: r.u_id, name: r.u_name } : null, product: r.p_name ? { name: r.p_name } : null }));
    
    const totalProduced = production.reduce((sum, row) => sum + row.producedQuantity, 0);
    const totalTarget = production.reduce((sum, row) => sum + row.targetQuantity, 0);
    
    res.json({
        production: { totalProduced, totalTarget, rejected: production.reduce((sum, row) => sum + row.rejectedQuantity, 0), completionPercentage: totalTarget ? Math.round(totalProduced / totalTarget * 100) : 0, rows: production },
        inventory: { availableStock: products.reduce((sum, row) => sum + Math.max(0, row.stockCases - row.reservedStock), 0), damagedStock: products.reduce((sum, row) => sum + row.damagedStock, 0), lowStock: products.filter((row) => row.stockCases <= row.minimumStockLevel).length, rows: products },
        dispatch: { total: dispatches.length, delivered: dispatches.filter((row) => row.status === DispatchStatus.DELIVERED).length, failed: dispatches.filter((row) => row.status === DispatchStatus.FAILED).length, rows: dispatches },
    });
});
