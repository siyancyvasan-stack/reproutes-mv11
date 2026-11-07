import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';

export const auditRouter = Router();
auditRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER));

auditRouter.get('/', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    
    let whereClause = 'tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (req.query.entity) {
        whereClause += ' AND entity = ?';
        params.push(String(req.query.entity));
    }
    
    const [countRes] = await db.query(`SELECT COUNT(*) as c FROM AuditLog WHERE ${whereClause}`, params);
    const total = countRes[0].c;
    
    const [logs] = await db.query(
        `SELECT a.*, u.id as u_id, u.name as u_name, u.email as u_email 
         FROM AuditLog a LEFT JOIN User u ON a.actorId = u.id 
         WHERE a.${whereClause} ORDER BY a.createdAt DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
    );
    
    const items = logs.map(a => {
        const item = { ...a, id: a.id.toString() };
        item.actor = a.u_id ? { id: a.u_id, name: a.u_name, email: a.u_email } : null;
        delete item.u_id; delete item.u_name; delete item.u_email;
        return item;
    });
    
    res.json({ items, pagination: { page, limit, total } });
});
