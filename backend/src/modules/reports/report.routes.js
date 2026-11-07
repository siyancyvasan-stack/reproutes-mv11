import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { dashboardDateRange } from '../../lib/dateRange.js';

export const reportRouter = Router();
reportRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER));

reportRouter.get('/orders.xlsx', async (req, res) => {
    const [orders] = await db.query(
        'SELECT o.*, u.id as u_id, u.name as u_name FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ? ORDER BY o.createdAt DESC LIMIT 5000',
        [req.auth.tenantId]
    );
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Orders');
    sheet.columns = [
        { header: 'Order ID', key: 'id', width: 28 }, { header: 'Agent', key: 'agent', width: 24 },
        { header: 'Shop', key: 'shop', width: 30 }, { header: 'Status', key: 'status', width: 15 },
        { header: 'Total LKR', key: 'total', width: 18 }, { header: 'Created', key: 'created', width: 22 },
    ];
    
    orders.forEach((order) => {
        sheet.addRow({
            id: order.id,
            agent: order.u_name,
            shop: order.shopName,
            status: order.status,
            total: Number(order.totalAmountLkr),
            created: new Date(order.createdAt).toISOString()
        });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reproutes-orders.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
});

reportRouter.get('/summary.pdf', async (req, res) => {
    const { from, to } = dashboardDateRange(req.query);
    
    const [[countRow], [revenueRow]] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [req.auth.tenantId, from, to]),
        db.query('SELECT SUM(totalAmountLkr) as s FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [req.auth.tenantId, from, to])
    ]);
    
    const orderCount = countRow[0].c;
    const revenue = revenueRow[0].s;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="reproutes-summary.pdf"');
    
    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);
    doc.fontSize(22).text('Reproutes Operations Summary').moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Range: ${from.toISOString()} to ${to.toISOString()}`);
    doc.text(`Total orders: ${orderCount}`);
    doc.text(`Total revenue: LKR ${Number(revenue ?? 0).toLocaleString()}`);
    doc.end();
});
