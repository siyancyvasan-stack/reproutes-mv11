import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { dashboardDateRange } from '../../lib/dateRange.js';

export const analyticsRouter = Router();

// Sales analytics are deliberately manager-only. Factory managers use /factory/dashboard.
analyticsRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER));

analyticsRouter.get('/dashboard', async (req, res) => {
    const tenantId = req.auth.tenantId;
    const { from: start, to: end } = dashboardDateRange(req.query);
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const isSingleDay = end.getTime() - start.getTime() <= 86_400_000;
    const comparisonDate = isSingleDay ? start : today;
    const comparisonDayStart = new Date(comparisonDate);
    comparisonDayStart.setHours(0, 0, 0, 0);
    const comparisonDayEnd = new Date(comparisonDate);
    comparisonDayEnd.setHours(23, 59, 59, 999);
    const comparisonMonthStart = new Date(comparisonDate.getFullYear(), comparisonDate.getMonth(), 1);
    const comparisonMonthEnd = new Date(comparisonDate.getFullYear(), comparisonDate.getMonth() + 1, 0, 23, 59, 59, 999);

    const [
        [agentsRes], [activeAgentsRes], [agentsOnBreakRes], [offlineAgentsRes], 
        [ordersRes], [revenueRes], [statusesRes], [attendanceRes], 
        [orderRowsRes], [productionRes], [dispatchRes], [factoryAttendanceRes], 
        [bestProductsRes], [comparisonOrderRowsRes]
    ] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM User WHERE tenantId = ? AND role = ?', [tenantId, Role.AGENT]),
        db.query('SELECT COUNT(*) as c FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE p.status = ? AND u.tenantId = ? AND u.role = ?', ['ACTIVE', tenantId, Role.AGENT]),
        db.query('SELECT COUNT(*) as c FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE p.status = ? AND u.tenantId = ? AND u.role = ?', ['ON_BREAK', tenantId, Role.AGENT]),
        db.query('SELECT COUNT(*) as c FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE p.status = ? AND u.tenantId = ? AND u.role = ?', ['OFFLINE', tenantId, Role.AGENT]),
        db.query('SELECT COUNT(*) as c FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, start, end]),
        db.query('SELECT SUM(totalAmountLkr) as s FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, start, end]),
        db.query('SELECT status, COUNT(*) as _count FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ? GROUP BY status ORDER BY status ASC', [tenantId, start, end]),
        db.query('SELECT COUNT(*) as c FROM Attendance WHERE tenantId = ? AND date >= ? AND date <= ?', [tenantId, start, end]),
        db.query('SELECT o.agentId, o.createdAt, o.totalAmountLkr, o.status, u.name as agentName FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ? AND o.createdAt >= ? AND o.createdAt <= ?', [tenantId, start, end]),
        db.query('SELECT SUM(producedQuantity) as s FROM ProductionOrder WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, start, end]),
        db.query('SELECT COUNT(*) as c FROM Dispatch WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, start, end]),
        db.query('SELECT COUNT(*) as c FROM FactoryAttendance WHERE tenantId = ? AND date >= ? AND date <= ?', [tenantId, start, end]),
        db.query('SELECT productId, SUM(cases) as cases, SUM(totalAmount) as totalAmount FROM OrderItem i JOIN `Order` o ON i.orderId = o.id WHERE o.tenantId = ? AND o.createdAt >= ? AND o.createdAt <= ? GROUP BY productId ORDER BY cases DESC LIMIT 8', [tenantId, start, end]),
        db.query('SELECT createdAt, totalAmountLkr, status FROM `Order` WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, comparisonMonthStart, comparisonMonthEnd])
    ]);

    const periodSummary = (from, to) => {
        const rows = comparisonOrderRowsRes.filter((row) => new Date(row.createdAt) >= from && new Date(row.createdAt) <= to);
        return { 
            sales: rows.reduce((sum, row) => sum + Number(row.totalAmountLkr), 0), 
            orders: rows.length, 
            pendingOrders: rows.filter((row) => row.status === 'PENDING' || row.status === 'APPROVED').length, 
            completedOrders: rows.filter((row) => row.status === 'DELIVERED').length 
        };
    };

    const bySalesperson = Object.values(orderRowsRes.reduce((summary, row) => { 
        const person = summary[row.agentId] ?? { id: row.agentId, name: row.agentName, sales: 0, orders: 0 }; 
        person.sales += Number(row.totalAmountLkr); 
        person.orders += 1; 
        summary[row.agentId] = person; 
        return summary; 
    }, {})).sort((a, b) => b.sales - a.sales);

    const salesTrend = Object.values(orderRowsRes.reduce((summary, row) => { 
        const key = new Date(row.createdAt).toISOString().slice(0, 10); 
        const point = summary[key] ?? { date: key, sales: 0, orders: 0 }; 
        point.sales += Number(row.totalAmountLkr); 
        point.orders += 1; 
        summary[key] = point; 
        return summary; 
    }, {}));

    let productRows = [];
    if (bestProductsRes.length > 0) {
        const productIds = bestProductsRes.map(row => row.productId);
        const placeholders = productIds.map(() => '?').join(',');
        [productRows] = await db.query(`SELECT id, name FROM Product WHERE id IN (${placeholders})`, productIds);
    }

    const [
        [dailyProductionRes], [monthlyProductionRes], 
        [dailyDispatchRes], [monthlyDispatchRes], 
        [dailyAttendanceRes], [monthlyAttendanceRes]
    ] = await Promise.all([
        db.query('SELECT SUM(producedQuantity) as s FROM ProductionOrder WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, comparisonDayStart, comparisonDayEnd]),
        db.query('SELECT SUM(producedQuantity) as s FROM ProductionOrder WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, comparisonMonthStart, comparisonMonthEnd]),
        db.query('SELECT COUNT(*) as c FROM Dispatch WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, comparisonDayStart, comparisonDayEnd]),
        db.query('SELECT COUNT(*) as c FROM Dispatch WHERE tenantId = ? AND createdAt >= ? AND createdAt <= ?', [tenantId, comparisonMonthStart, comparisonMonthEnd]),
        db.query('SELECT COUNT(*) as c FROM Attendance WHERE tenantId = ? AND date >= ? AND date <= ?', [tenantId, comparisonDayStart, comparisonDayEnd]),
        db.query('SELECT COUNT(*) as c FROM Attendance WHERE tenantId = ? AND date >= ? AND date <= ?', [tenantId, comparisonMonthStart, comparisonMonthEnd])
    ]);

    const dailySummary = periodSummary(comparisonDayStart, comparisonDayEnd);
    const monthlySummary = periodSummary(comparisonMonthStart, comparisonMonthEnd);

    res.json({
        range: { from: start, to: end },
        lastUpdatedAt: new Date(),
        kpis: {
            agents: agentsRes[0].c,
            activeAgents: activeAgentsRes[0].c,
            agentsOnBreak: agentsOnBreakRes[0].c,
            offlineAgents: offlineAgentsRes[0].c,
            orders: ordersRes[0].c,
            revenueLkr: Number(revenueRes[0].s ?? 0),
            attendance: attendanceRes[0].c,
            production: Number(productionRes[0].s ?? 0),
            dispatch: dispatchRes[0].c,
            factoryAttendance: factoryAttendanceRes[0].c,
        },
        orderStatus: statusesRes.map(s => ({ status: s.status, _count: s._count })),
        daily: { ...dailySummary, revenue: dailySummary.sales, production: Number(dailyProductionRes[0].s ?? 0), dispatch: dailyDispatchRes[0].c, attendance: dailyAttendanceRes[0].c },
        monthly: { ...monthlySummary, revenue: monthlySummary.sales, production: Number(monthlyProductionRes[0].s ?? 0), dispatch: monthlyDispatchRes[0].c, attendance: monthlyAttendanceRes[0].c },
        bySalesperson,
        bestSalesperson: bySalesperson[0] ?? null,
        bestProducts: bestProductsRes.map((row) => ({ name: productRows.find((product) => product.id === row.productId)?.name ?? row.productId, cases: Number(row.cases ?? 0), sales: Number(row.totalAmount ?? 0) })),
        salesTrend,
    });
});
