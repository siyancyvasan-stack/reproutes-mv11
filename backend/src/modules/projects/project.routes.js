import { Role } from '../../lib/enums.js';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { randomUUID } from 'node:crypto';

export const projectRouter = Router();
projectRouter.use(authenticate, authorize(Role.MANAGER));

const paging = (query) => ({ page: Math.max(1, Number(query.page) || 1), limit: Math.min(100, Math.max(1, Number(query.limit) || 20)) });
const projectInput = z.object({ name: z.string().trim().min(2).max(160), description: z.string().max(3000).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), startsAt: z.string().datetime().optional(), dueAt: z.string().datetime().optional() });

projectRouter.get('/', async (req, res) => {
    const { page, limit } = paging(req.query);
    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    
    let whereClause = 'tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
    }
    if (search) {
        whereClause += ' AND name LIKE ?';
        params.push(`%${search}%`);
    }
    
    const [countRes] = await db.query(`SELECT COUNT(*) as c FROM Project WHERE ${whereClause}`, params);
    const total = countRes[0].c;
    
    const [projects] = await db.query(
        `SELECT p.*, u.id as u_id, u.name as u_name 
         FROM Project p LEFT JOIN User u ON p.ownerId = u.id 
         WHERE p.${whereClause} ORDER BY p.updatedAt DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
    );
    
    const items = projects.map(p => {
        const item = { ...p };
        item.owner = p.u_id ? { id: p.u_id, name: p.u_name } : null;
        delete item.u_id; delete item.u_name;
        item._count = { tasks: 0, milestones: 0 };
        return item;
    });
    
    if (items.length > 0) {
        const projectIds = items.map(p => p.id);
        const placeholders = projectIds.map(() => '?').join(',');
        
        const [[tasksCount], [milestonesCount]] = await Promise.all([
            db.query(`SELECT projectId, COUNT(*) as c FROM ProjectTask WHERE projectId IN (${placeholders}) GROUP BY projectId`, projectIds),
            db.query(`SELECT projectId, COUNT(*) as c FROM ProjectMilestone WHERE projectId IN (${placeholders}) GROUP BY projectId`, projectIds)
        ]);
        
        const tCounts = new Map(tasksCount.map(r => [r.projectId, r.c]));
        const mCounts = new Map(milestonesCount.map(r => [r.projectId, r.c]));
        
        items.forEach(item => {
            item._count.tasks = tCounts.get(item.id) ?? 0;
            item._count.milestones = mCounts.get(item.id) ?? 0;
        });
    }
    
    res.json({ items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

projectRouter.post('/', async (req, res) => {
    const input = projectInput.parse(req.body);
    const id = randomUUID();
    
    const data = {
        id,
        tenantId: req.auth.tenantId,
        ownerId: req.auth.sub,
        name: input.name,
        description: input.description ?? null,
        priority: input.priority,
        status: 'PLANNING',
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    const keys = Object.keys(data);
    const values = keys.map(k => data[k]);
    const placeholders = keys.map(() => '?').join(',');
    
    await db.query(`INSERT INTO Project (${keys.join(',')}) VALUES (${placeholders})`, values);
    const [projects] = await db.query('SELECT * FROM Project WHERE id = ?', [id]);
    
    res.status(201).json(projects[0]);
});

projectRouter.get('/tasks', async (req, res) => {
    const [tasks] = await db.query(
        `SELECT t.*, p.id as p_id, p.name as p_name, u.id as u_id, u.name as u_name 
         FROM ProjectTask t 
         LEFT JOIN Project p ON t.projectId = p.id 
         LEFT JOIN User u ON t.assigneeId = u.id 
         WHERE t.tenantId = ? 
         ORDER BY t.dueAt ASC, t.createdAt DESC LIMIT 100`,
        [req.auth.tenantId]
    );
    
    const items = tasks.map(t => {
        const item = { ...t };
        item.project = t.p_id ? { id: t.p_id, name: t.p_name } : null;
        item.assignee = t.u_id ? { id: t.u_id, name: t.u_name } : null;
        delete item.p_id; delete item.p_name;
        delete item.u_id; delete item.u_name;
        return item;
    });
    
    res.json({ items });
});

projectRouter.get('/team-status', async (req, res) => {
    const [users] = await db.query(
        'SELECT id, name, role FROM User WHERE tenantId = ? AND status = ?',
        [req.auth.tenantId, 'ACTIVE']
    );
    
    const items = users.map(u => ({ ...u, assignedProjectTasks: [] }));
    
    if (items.length > 0) {
        const userIds = items.map(u => u.id);
        const placeholders = userIds.map(() => '?').join(',');
        
        const [tasks] = await db.query(
            `SELECT id, title, priority, dueAt, assigneeId FROM ProjectTask WHERE assigneeId IN (${placeholders}) AND status != 'DONE'`,
            userIds
        );
        
        const tasksMap = new Map();
        tasks.forEach(t => {
            if (!tasksMap.has(t.assigneeId)) tasksMap.set(t.assigneeId, []);
            tasksMap.get(t.assigneeId).push({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt });
        });
        
        items.forEach(u => {
            u.assignedProjectTasks = tasksMap.get(u.id) ?? [];
        });
    }
    
    res.json({ items });
});

projectRouter.get('/progress', async (req, res) => {
    const [projects] = await db.query('SELECT id, name, status FROM Project WHERE tenantId = ?', [req.auth.tenantId]);
    
    if (projects.length === 0) return res.json({ items: [] });
    
    const projectIds = projects.map(p => p.id);
    const placeholders = projectIds.map(() => '?').join(',');
    
    const [[tasks], [milestones]] = await Promise.all([
        db.query(`SELECT projectId, status FROM ProjectTask WHERE projectId IN (${placeholders})`, projectIds),
        db.query(`SELECT projectId, status FROM ProjectMilestone WHERE projectId IN (${placeholders})`, projectIds)
    ]);
    
    const tMap = new Map();
    const mMap = new Map();
    
    tasks.forEach(t => {
        if (!tMap.has(t.projectId)) tMap.set(t.projectId, { total: 0, completed: 0 });
        const obj = tMap.get(t.projectId);
        obj.total++;
        if (t.status === 'DONE') obj.completed++;
    });
    
    milestones.forEach(m => {
        if (!mMap.has(m.projectId)) mMap.set(m.projectId, { total: 0, completed: 0 });
        const obj = mMap.get(m.projectId);
        obj.total++;
        if (m.status === 'DONE') obj.completed++;
    });
    
    const items = projects.map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        totalTasks: tMap.get(p.id)?.total ?? 0,
        completedTasks: tMap.get(p.id)?.completed ?? 0,
        totalMilestones: mMap.get(p.id)?.total ?? 0,
        completedMilestones: mMap.get(p.id)?.completed ?? 0
    }));
    
    res.json({ items });
});

projectRouter.get('/reports', async (req, res) => {
    const [[projectsCount], [overdueTasksCount], [tasksGroupBy]] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM Project WHERE tenantId = ?', [req.auth.tenantId]),
        db.query('SELECT COUNT(*) as c FROM ProjectTask WHERE tenantId = ? AND status != ? AND dueAt < ?', [req.auth.tenantId, 'DONE', new Date()]),
        db.query('SELECT status, COUNT(*) as _all FROM ProjectTask WHERE tenantId = ? GROUP BY status ORDER BY status ASC', [req.auth.tenantId])
    ]);
    
    const tasksByStatus = tasksGroupBy.map(t => ({ status: t.status, _count: { _all: t._all } }));
    
    res.json({ items: [{ id: 'portfolio', title: 'Portfolio summary', projects: projectsCount[0].c, overdueTasks: overdueTasksCount[0].c, tasksByStatus }] });
});

projectRouter.get('/:id', async (req, res) => {
    const [projects] = await db.query(
        'SELECT p.*, u.id as u_id, u.name as u_name FROM Project p LEFT JOIN User u ON p.ownerId = u.id WHERE p.id = ? AND p.tenantId = ?',
        [req.params.id, req.auth.tenantId]
    );
    
    const project = projects[0];
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND' } });
    
    project.owner = project.u_id ? { id: project.u_id, name: project.u_name } : null;
    delete project.u_id; delete project.u_name;
    
    const [[milestones], [tasks]] = await Promise.all([
        db.query('SELECT * FROM ProjectMilestone WHERE projectId = ? ORDER BY sortOrder ASC', [project.id]),
        db.query('SELECT t.*, u.id as u_id, u.name as u_name FROM ProjectTask t LEFT JOIN User u ON t.assigneeId = u.id WHERE t.projectId = ?', [project.id])
    ]);
    
    project.milestones = milestones;
    project.tasks = tasks.map(t => {
        const task = { ...t };
        task.assignee = t.u_id ? { id: t.u_id, name: t.u_name } : null;
        delete task.u_id; delete task.u_name;
        return task;
    });
    
    return res.json(project);
});

projectRouter.post('/:id/tasks', async (req, res) => {
    const input = z.object({ title: z.string().min(2).max(200), description: z.string().max(2000).optional(), assigneeId: z.string().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), dueAt: z.string().datetime().optional() }).parse(req.body);
    
    const [projects] = await db.query('SELECT id FROM Project WHERE id = ? AND tenantId = ?', [req.params.id, req.auth.tenantId]);
    if (projects.length === 0) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND' } });
    
    const taskId = randomUUID();
    const data = {
        id: taskId,
        projectId: req.params.id,
        tenantId: req.auth.tenantId,
        createdById: req.auth.sub,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        priority: input.priority,
        status: 'TODO',
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    const keys = Object.keys(data);
    const values = keys.map(k => data[k]);
    const placeholders = keys.map(() => '?').join(',');
    
    await db.query(`INSERT INTO ProjectTask (${keys.join(',')}) VALUES (${placeholders})`, values);
    
    if (input.assigneeId) {
        await db.query(
            'INSERT INTO Notification (id, tenantId, userId, type, title, message) VALUES (?, ?, ?, ?, ?)',
            [req.auth.tenantId, input.assigneeId, 'TASK_ASSIGNED', 'New task assigned', input.title]
        );
    }
    
    const [tasks] = await db.query('SELECT * FROM ProjectTask WHERE id = ?', [taskId]);
    return res.status(201).json(tasks[0]);
});

projectRouter.patch('/:projectId/tasks/:taskId', async (req, res) => {
    const input = z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(), assigneeId: z.string().nullable().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), dueAt: z.string().datetime().nullable().optional() }).parse(req.body);
    
    const updateFields = [];
    const updateParams = [];
    
    if (input.status !== undefined) {
        updateFields.push('status = ?'); updateParams.push(input.status);
        if (input.status === 'DONE') { updateFields.push('completedAt = ?'); updateParams.push(new Date()); }
        else { updateFields.push('completedAt = NULL'); }
    }
    if (input.assigneeId !== undefined) { updateFields.push('assigneeId = ?'); updateParams.push(input.assigneeId); }
    if (input.priority !== undefined) { updateFields.push('priority = ?'); updateParams.push(input.priority); }
    if (input.dueAt !== undefined) { updateFields.push('dueAt = ?'); updateParams.push(input.dueAt ? new Date(input.dueAt) : null); }
    
    if (updateFields.length > 0) {
        updateFields.push('updatedAt = ?'); updateParams.push(new Date());
        
        const [result] = await db.query(
            `UPDATE ProjectTask SET ${updateFields.join(', ')} WHERE id = ? AND projectId = ? AND tenantId = ?`,
            [...updateParams, req.params.taskId, req.params.projectId, req.auth.tenantId]
        );
        
        if (result.affectedRows === 0) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND' } });
    } else {
        const [existing] = await db.query('SELECT id FROM ProjectTask WHERE id = ? AND projectId = ? AND tenantId = ?', [req.params.taskId, req.params.projectId, req.auth.tenantId]);
        if (existing.length === 0) return res.status(404).json({ error: { code: 'TASK_NOT_FOUND' } });
    }
    
    const [tasks] = await db.query('SELECT * FROM ProjectTask WHERE id = ?', [req.params.taskId]);
    return res.json(tasks[0]);
});
