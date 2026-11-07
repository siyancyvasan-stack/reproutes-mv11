import PDFDocument from 'pdfkit';
import { InvoiceStatus, Role } from '../../lib/enums.js';
import { Router } from 'express';
import { z } from 'zod';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { randomUUID } from 'node:crypto';

export const invoiceRouter = Router();
invoiceRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER));

invoiceRouter.get('/', async (req, res) => {
    await db.query(
        'UPDATE Invoice SET status = ? WHERE tenantId = ? AND status = ? AND dueAt < ?',
        [InvoiceStatus.OVERDUE, req.auth.tenantId, InvoiceStatus.PENDING, new Date()]
    );
    
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? '').trim();
    const parsed = z.nativeEnum(InvoiceStatus).safeParse(req.query.status);
    const status = parsed.success ? parsed.data : undefined;
    
    let countQuery = 'SELECT COUNT(DISTINCT i.id) as c FROM Invoice i LEFT JOIN `Order` o ON i.orderId = o.id LEFT JOIN User u ON i.salespersonId = u.id WHERE i.tenantId = ?';
    let dataQuery = 'SELECT i.*, o.id as o_id, o.shopName as o_shopName, o.shopAddress as o_shopAddress, o.createdAt as o_createdAt, u.id as u_id, u.name as u_name, s.id as s_id, s.name as s_name FROM Invoice i LEFT JOIN `Order` o ON i.orderId = o.id LEFT JOIN User u ON i.salespersonId = u.id LEFT JOIN Shop s ON i.shopId = s.id WHERE i.tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (status) {
        countQuery += ' AND i.status = ?';
        dataQuery += ' AND i.status = ?';
        params.push(status);
    }
    
    if (search) {
        countQuery += ' AND (i.invoiceNumber LIKE ? OR o.shopName LIKE ? OR u.name LIKE ?)';
        dataQuery += ' AND (i.invoiceNumber LIKE ? OR o.shopName LIKE ? OR u.name LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
    }
    
    const [countRes] = await db.query(countQuery, params);
    const total = countRes[0].c;
    
    dataQuery += ' ORDER BY i.issuedAt DESC LIMIT ? OFFSET ?';
    const [invoices] = await db.query(dataQuery, [...params, limit, (page - 1) * limit]);
    
    const items = invoices.map(i => {
        const item = { ...i };
        item.order = i.o_id ? { id: i.o_id, shopName: i.o_shopName, shopAddress: i.o_shopAddress, createdAt: i.o_createdAt } : null;
        item.salesperson = i.u_id ? { id: i.u_id, name: i.u_name } : null;
        item.shop = i.s_id ? { id: i.s_id, name: i.s_name } : null;
        
        delete item.o_id; delete item.o_shopName; delete item.o_shopAddress; delete item.o_createdAt;
        delete item.u_id; delete item.u_name;
        delete item.s_id; delete item.s_name;
        
        item.payments = [];
        return item;
    });
    
    if (items.length > 0) {
        const invoiceIds = items.map(i => i.id);
        const placeholders = invoiceIds.map(() => '?').join(',');
        
        const [payments] = await db.query(`SELECT * FROM Payment WHERE invoiceId IN (${placeholders}) ORDER BY paidAt DESC`, invoiceIds);
        
        const paymentsMap = new Map();
        payments.forEach(p => {
            if (!paymentsMap.has(p.invoiceId)) paymentsMap.set(p.invoiceId, []);
            paymentsMap.get(p.invoiceId).push(p);
        });
        
        items.forEach(i => {
            i.payments = paymentsMap.get(i.id) ?? [];
        });
    }
    
    res.json({ items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

invoiceRouter.post('/:id/payments', async (req, res) => {
    const input = z.object({ amountLkr: z.coerce.number().positive(), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT']), reference: z.string().max(120).optional() }).parse(req.body);
    const invoiceId = String(req.params.id);
    
    const [invoices] = await db.query('SELECT * FROM Invoice WHERE id = ? AND tenantId = ?', [invoiceId, req.auth.tenantId]);
    const invoice = invoices[0];
    
    if (!invoice) {
        res.status(404).json({ error: { code: 'INVOICE_NOT_FOUND' } });
        return;
    }
    const remaining = Number(invoice.totalLkr) - Number(invoice.paidLkr);
    if (input.amountLkr > remaining + .01) {
        res.status(422).json({ error: { code: 'PAYMENT_EXCEEDS_BALANCE' } });
        return;
    }
    const paidLkr = Number(invoice.paidLkr) + input.amountLkr;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        const paymentId = randomUUID();
        await connection.query(
            'INSERT INTO Payment (id, tenantId, invoiceId, amountLkr, method, reference, recordedById, paidAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [paymentId, req.auth.tenantId, invoice.id, input.amountLkr, input.method, input.reference ?? null, req.auth.sub, new Date()]
        );
        
        const status = paidLkr >= Number(invoice.totalLkr) ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;
        await connection.query(
            'UPDATE Invoice SET paidLkr = ?, status = ? WHERE id = ?',
            [paidLkr, status, invoice.id]
        );
        
        const [resInvoice] = await connection.query('SELECT * FROM Invoice WHERE id = ?', [invoice.id]);
        const [resPayments] = await connection.query('SELECT * FROM Payment WHERE invoiceId = ? ORDER BY paidAt DESC', [invoice.id]);
        
        updated = resInvoice[0];
        updated.payments = resPayments;
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit('invoice:payment-recorded', updated);
    res.status(201).json(updated);
});

invoiceRouter.get('/:id/pdf', async (req, res) => {
    const invoiceId = String(req.params.id);
    
    const [invoices] = await db.query(
        'SELECT i.*, o.id as o_id, o.shopName as o_shopName, o.shopAddress as o_shopAddress, u.id as u_id, u.name as u_name FROM Invoice i LEFT JOIN `Order` o ON i.orderId = o.id LEFT JOIN User u ON i.salespersonId = u.id WHERE i.id = ? AND i.tenantId = ?',
        [invoiceId, req.auth.tenantId]
    );
    const invoice = invoices[0];
    
    if (!invoice) {
        res.status(404).json({ error: { code: 'INVOICE_NOT_FOUND' } });
        return;
    }
    
    invoice.order = invoice.o_id ? { id: invoice.o_id, shopName: invoice.o_shopName, shopAddress: invoice.o_shopAddress, items: [] } : null;
    invoice.salesperson = invoice.u_id ? { id: invoice.u_id, name: invoice.u_name } : null;
    
    if (invoice.order) {
        const [items] = await db.query(
            'SELECT i.*, p.id as p_id, p.name as p_name FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId = ?',
            [invoice.order.id]
        );
        invoice.order.items = items.map(i => ({ ...i, product: { id: i.p_id, name: i.p_name }, p_id: undefined, p_name: undefined }));
    }
    
    const [payments] = await db.query('SELECT * FROM Payment WHERE invoiceId = ? ORDER BY paidAt DESC', [invoiceId]);
    invoice.payments = payments;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.pdf"`);
    
    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);
    doc.fontSize(22).text('RepRoutes Invoice').fontSize(11).text(invoice.invoiceNumber).moveDown();
    doc.text(`Issued: ${new Date(invoice.issuedAt).toISOString().slice(0, 10)}`).text(`Due: ${new Date(invoice.dueAt).toISOString().slice(0, 10)}`).text(`Shop: ${invoice.order?.shopName ?? 'N/A'}`).text(`Salesperson: ${invoice.salesperson?.name ?? 'N/A'}`).moveDown();
    
    if (invoice.order && invoice.order.items) {
        invoice.order.items.forEach((item) => doc.text(`${item.product.name}  ${item.cases} cases  LKR ${Number(item.totalAmount).toLocaleString()}`));
    }
    
    doc.moveDown().fontSize(14).text(`Total: LKR ${Number(invoice.totalLkr).toLocaleString()}`).text(`Paid: LKR ${Number(invoice.paidLkr).toLocaleString()}`).text(`Balance: LKR ${(Number(invoice.totalLkr) - Number(invoice.paidLkr)).toLocaleString()}`).text(`Status: ${invoice.status}`);
    doc.end();
});
