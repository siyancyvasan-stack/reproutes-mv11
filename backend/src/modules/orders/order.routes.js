import { Router } from 'express';
import { OrderStatus, Role } from '../../lib/enums.js';
import { z } from 'zod';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { recordAgentActivity } from '../agents/agent-activity.service.js';
import { randomUUID } from 'node:crypto';

export const orderRouter = Router();
orderRouter.use(authenticate);

orderRouter.get('/', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER, Role.AGENT), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = req.query.status && z.nativeEnum(OrderStatus).safeParse(req.query.status).success ? req.query.status : undefined;
    
    let whereClause = 'tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (req.auth.role === Role.AGENT) {
        whereClause += ' AND agentId = ?';
        params.push(req.auth.sub);
    }
    if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
    }
    
    const [countRes] = await db.query(`SELECT COUNT(*) as c FROM \`Order\` WHERE ${whereClause}`, params);
    const total = countRes[0].c;
    
    const [orders] = await db.query(
        `SELECT o.*, u.id as u_id, u.name as u_name 
         FROM \`Order\` o LEFT JOIN User u ON o.agentId = u.id 
         WHERE o.${whereClause} ORDER BY o.createdAt DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
    );
    
    const items = orders.map(o => ({
        ...o,
        agent: o.u_id ? { id: o.u_id, name: o.u_name } : null,
        u_id: undefined, u_name: undefined,
        items: []
    }));
    
    if (items.length > 0) {
        const orderIds = items.map(o => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        
        const [orderItems] = await db.query(
            `SELECT i.*, p.id as p_id, p.name as p_name, p.sku as p_sku, p.imageUrl as p_imageUrl, p.pricePerCaseLkr as p_pricePerCaseLkr 
             FROM OrderItem i JOIN Product p ON i.productId = p.id 
             WHERE i.orderId IN (${placeholders})`,
            orderIds
        );
        
        const itemsMap = new Map();
        orderItems.forEach(i => {
            if (!itemsMap.has(i.orderId)) itemsMap.set(i.orderId, []);
            itemsMap.get(i.orderId).push({
                ...i,
                product: { id: i.p_id, name: i.p_name, sku: i.p_sku, imageUrl: i.p_imageUrl, pricePerCaseLkr: i.p_pricePerCaseLkr },
                p_id: undefined, p_name: undefined, p_sku: undefined, p_imageUrl: undefined, p_pricePerCaseLkr: undefined
            });
        });
        
        items.forEach(o => {
            o.items = itemsMap.get(o.id) ?? [];
        });
    }
    
    res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

orderRouter.post('/', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    const input = z.object({
        agentId: z.string().optional(),
        shopId: z.string().optional(),
        shopVisitId: z.string().optional(),
        shopName: z.string().min(2),
        shopAddress: z.string().min(2),
        paymentTerm: z.string().min(2),
        remarks: z.string().max(1000).optional(),
        items: z.array(z.object({ productId: z.string(), cases: z.number().int().positive() })).min(1),
        clientOperationId: z.string().max(160).optional(),
    }).parse(req.body);
    
    const agentId = req.auth.role === Role.AGENT ? req.auth.sub : input.agentId ?? req.auth.sub;
    
    if (input.clientOperationId) {
        const [existingOrders] = await db.query('SELECT * FROM `Order` WHERE agentId = ? AND clientOperationId = ? LIMIT 1', [agentId, input.clientOperationId]);
        if (existingOrders.length > 0) {
            const existing = existingOrders[0];
            const [existingItems] = await db.query('SELECT * FROM OrderItem WHERE orderId = ?', [existing.id]);
            existing.items = existingItems;
            return res.json(existing);
        }
    }
    
    if (input.shopVisitId) {
        let visitQuery = 'SELECT id FROM ShopVisit WHERE id = ? AND tenantId = ? AND agentId = ?';
        const params = [input.shopVisitId, req.auth.tenantId, agentId];
        if (input.shopId) {
            visitQuery += ' AND shopId = ?';
            params.push(input.shopId);
        }
        const [visits] = await db.query(visitQuery + ' LIMIT 1', params);
        if (visits.length === 0)
            return res.status(403).json({ error: { code: 'INVALID_VISIT_LINK' } });
    }
    
    const productIds = input.items.map(item => item.productId);
    const uniqueProductIds = [...new Set(productIds)];
    const placeholders = uniqueProductIds.map(() => '?').join(',');
    
    const [products] = await db.query(`SELECT id, pricePerCaseLkr FROM Product WHERE id IN (${placeholders}) AND tenantId = ? AND active = ?`, [...uniqueProductIds, req.auth.tenantId, true]);
    
    if (products.length !== uniqueProductIds.length)
        return res.status(422).json({ error: { code: 'INVALID_PRODUCT' } });
        
    const itemData = input.items.map((item) => {
        const product = products.find((value) => value.id === item.productId);
        return { productId: item.productId, cases: item.cases, unitPrice: product.pricePerCaseLkr, totalAmount: Number(product.pricePerCaseLkr) * item.cases };
    });
    
    const totalAmountLkr = itemData.reduce((sum, item) => sum + Number(item.totalAmount), 0);
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let createdOrder;
    try {
        const orderId = randomUUID();
        const createdAt = new Date();
        
        await connection.query(
            'INSERT INTO `Order` (id, tenantId, agentId, shopId, shopVisitId, shopName, shopAddress, paymentTerm, remarks, clientOperationId, totalAmountLkr, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [orderId, req.auth.tenantId, agentId, input.shopId ?? null, input.shopVisitId ?? null, input.shopName, input.shopAddress, input.paymentTerm, input.remarks ?? null, input.clientOperationId ?? null, totalAmountLkr, OrderStatus.PENDING, createdAt]
        );
        
        for (const item of itemData) {
            const itemId = randomUUID();
            await connection.query(
                'INSERT INTO OrderItem (id, orderId, productId, cases, unitPrice, totalAmount) VALUES (?, ?, ?, ?, ?, ?)',
                [itemId, orderId, item.productId, item.cases, item.unitPrice, item.totalAmount]
            );
        }
        
        const invoiceId = randomUUID();
        const invoiceNumber = `INV-${Date.now()}-${orderId.slice(-5).toUpperCase()}`;
        const issuedAt = new Date();
        const dueAt = new Date(Date.now() + 30 * 86_400_000);
        
        await connection.query(
            'INSERT INTO Invoice (id, tenantId, invoiceNumber, orderId, shopId, salespersonId, subtotalLkr, totalLkr, dueAt, issuedAt, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [invoiceId, req.auth.tenantId, invoiceNumber, orderId, input.shopId ?? null, agentId, totalAmountLkr, totalAmountLkr, dueAt, issuedAt, 'PENDING']
        );
        
        await recordAgentActivity({ tenantId: req.auth.tenantId, agentId, eventType: 'ORDER_CREATED', occurredAt: createdAt, visitId: input.shopVisitId, entityType: 'Order', entityId: orderId, sourceKey: `order:${orderId}`, metadata: { title: `Order created · ${input.shopName}`, detail: `LKR ${totalAmountLkr.toLocaleString()}` } }, connection);
        await recordAgentActivity({ tenantId: req.auth.tenantId, agentId, eventType: 'INVOICE_CREATED', occurredAt: issuedAt, visitId: input.shopVisitId, entityType: 'Invoice', entityId: invoiceId, sourceKey: `invoice:${invoiceId}`, metadata: { title: `Invoice created · ${invoiceNumber}`, detail: `LKR ${totalAmountLkr.toLocaleString()}` } }, connection);
        
        if (input.shopId) {
            await connection.query('UPDATE Shop SET lastOrderAt = ? WHERE id = ?', [new Date(), input.shopId]);
        }
        
        const [ordersRes] = await connection.query('SELECT * FROM `Order` WHERE id = ?', [orderId]);
        const [itemsRes] = await connection.query('SELECT * FROM OrderItem WHERE orderId = ?', [orderId]);
        
        createdOrder = ordersRes[0];
        createdOrder.items = itemsRes;
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    const [recipients] = await db.query(
        'SELECT id FROM User WHERE tenantId = ? AND role IN (?, ?, ?) AND status = ?',
        [req.auth.tenantId, Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER, 'ACTIVE']
    );
    
    if (recipients.length) {
        const values = recipients.map(r => `(UUID(), '${req.auth.tenantId}', '${r.id}', 'NEW_ORDER', 'New sales order', '${createdOrder.id} was created for ${createdOrder.shopName}')`).join(',');
        await db.query(`INSERT INTO Notification (id, tenantId, userId, type, title, message) VALUES ${values}`);
    }
        
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}:role:${Role.MANAGER}`).to(`tenant:${req.auth.tenantId}:role:${Role.FACTORY_MANAGER}`).emit('factory:new-order', createdOrder);
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('activity:updated', { agentId, visitId: input.shopVisitId, type: 'ORDER_CREATED' });
    
    res.status(201).json(createdOrder);
});

orderRouter.patch('/:id/status', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const { status } = z.object({ status: z.nativeEnum(OrderStatus) }).parse(req.body);
    const id = String(req.params.id);
    
    const [result] = await db.query('UPDATE `Order` SET status = ? WHERE id = ? AND tenantId = ?', [status, id, req.auth.tenantId]);
    if (result.affectedRows === 0)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
        
    const [updatedRows] = await db.query('SELECT * FROM `Order` WHERE id = ?', [id]);
    const updated = updatedRows[0];
    
    if (updated && status === OrderStatus.APPROVED) {
        await db.query(
            'INSERT INTO Notification (id, tenantId, type, title, message) VALUES (?, ?, ?, ?)',
            [req.auth.tenantId, 'ORDER_APPROVED', 'Order approved', `${updated.id} is ready for factory review`]
        );
        req.app.get('io')?.to(`tenant:${req.auth.tenantId}:role:${Role.FACTORY_MANAGER}`).emit('factory:order-approved', updated);
    }
    return res.json(updated);
});

orderRouter.delete('/:id', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const id = String(req.params.id);
    
    const [orders] = await db.query('SELECT id, status FROM `Order` WHERE id = ? AND tenantId = ?', [id, req.auth.tenantId]);
    const order = orders[0];
    if (!order)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found.' } });
        
    const [[invoices], [po], [disp]] = await Promise.all([
        db.query('SELECT id FROM Invoice WHERE orderId = ?', [id]),
        db.query('SELECT COUNT(*) as c FROM ProductionOrder WHERE salesOrderId = ?', [id]),
        db.query('SELECT COUNT(*) as c FROM Dispatch WHERE orderId = ?', [id])
    ]);
    
    const invoice = invoices[0];
    let paymentsCount = 0;
    if (invoice) {
        const [pay] = await db.query('SELECT COUNT(*) as c FROM Payment WHERE invoiceId = ?', [invoice.id]);
        paymentsCount = pay[0].c;
    }
    
    if (po[0].c > 0 || disp[0].c > 0 || paymentsCount > 0) {
        return res.status(409).json({
            error: { code: 'ORDER_HAS_DEPENDENCIES', message: 'This order has production, dispatch, or payment records and cannot be deleted.' },
        });
    }
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        if (invoice) {
            await connection.query('DELETE FROM Invoice WHERE id = ?', [invoice.id]);
        }
        await connection.query('DELETE FROM `Order` WHERE id = ?', [id]);
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'ORDER_DELETED', 'Order', id, JSON.stringify({ previousStatus: order.status })]
        );
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('orders:changed', { id, action: 'deleted' });
    return res.status(204).send();
});
