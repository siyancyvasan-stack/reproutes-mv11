import { Role } from '../../lib/enums.js';
import { Router } from 'express';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';

export const searchRouter = Router();
searchRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER));

searchRouter.get('/', async (req, res) => {
    const query = String(req.query.q ?? '').trim();
    if (query.length < 2) {
        return res.json({ query, agents: [], orders: [], shops: [], products: [] });
    }
    
    const tenantId = req.auth.tenantId;
    const contains = `%${query}%`;
    
    const [[agents], [ordersRows], [shops], [products]] = await Promise.all([
        db.query(
            'SELECT id, name, employeeCode, avatarUrl FROM User WHERE tenantId = ? AND role = ? AND (name LIKE ? OR email LIKE ? OR employeeCode LIKE ?) ORDER BY name ASC LIMIT 5',
            [tenantId, Role.AGENT, contains, contains, contains]
        ),
        db.query(
            'SELECT o.id, o.shopName, o.status, o.totalAmountLkr, u.name as agentName FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ? AND (o.id LIKE ? OR o.shopName LIKE ? OR o.shopAddress LIKE ? OR u.name LIKE ?) ORDER BY o.createdAt DESC LIMIT 5',
            [tenantId, contains, contains, contains, contains]
        ),
        db.query(
            'SELECT id, name, ownerName, city FROM Shop WHERE tenantId = ? AND (name LIKE ? OR ownerName LIKE ? OR city LIKE ? OR address LIKE ?) ORDER BY name ASC LIMIT 5',
            [tenantId, contains, contains, contains, contains]
        ),
        db.query(
            'SELECT id, name, sku, category FROM Product WHERE tenantId = ? AND (name LIKE ? OR sku LIKE ? OR category LIKE ?) ORDER BY name ASC LIMIT 5',
            [tenantId, contains, contains, contains]
        )
    ]);
    
    const orders = ordersRows.map(o => ({
        id: o.id,
        shopName: o.shopName,
        status: o.status,
        totalAmountLkr: o.totalAmountLkr,
        agent: o.agentName ? { name: o.agentName } : null
    }));
    
    return res.json({ query, agents, orders, shops, products });
});
