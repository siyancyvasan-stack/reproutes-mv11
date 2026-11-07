import { Router } from 'express';
import { Role } from '../../lib/enums.js';
import { z } from 'zod';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { imageUpload } from '../../middleware/upload.js';
import { deletePermanentImage, uploadPermanentImage } from '../files/image-storage.service.js';
import { randomUUID } from 'node:crypto';

export const productRouter = Router();
productRouter.use(authenticate);

const productInput = z.object({
    name: z.string().min(2),
    sku: z.string().min(2),
    category: z.string().min(2),
    pricePerCaseLkr: z.coerce.number().nonnegative(),
    unitsPerCase: z.coerce.number().int().positive(),
    stockCases: z.coerce.number().int().nonnegative(),
    imageUrl: z.string().url().optional(),
    active: z.boolean().default(true),
});

productRouter.get('/', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search ?? '');
    
    let whereClause = 'tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (search) {
        whereClause += ' AND (name LIKE ? OR sku LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern);
    }
    
    const [countRes] = await db.query(`SELECT COUNT(*) as c FROM Product WHERE ${whereClause}`, params);
    const total = countRes[0].c;
    
    const [items] = await db.query(
        `SELECT * FROM Product WHERE ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
    );
    
    res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

productRouter.post('/', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const input = productInput.parse(req.body);
    const id = randomUUID();
    
    await db.query(
        'INSERT INTO Product (id, tenantId, name, sku, category, pricePerCaseLkr, unitsPerCase, stockCases, imageUrl, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, req.auth.tenantId, input.name, input.sku, input.category, input.pricePerCaseLkr, input.unitsPerCase, input.stockCases, input.imageUrl ?? null, input.active, new Date()]
    );
    
    const [created] = await db.query('SELECT * FROM Product WHERE id = ?', [id]);
    res.status(201).json(created[0]);
});

productRouter.patch('/:id', authorize(Role.ADMIN, Role.MANAGER), async (req, res) => {
    const input = productInput.partial().parse(req.body);
    const id = String(req.params.id);
    
    const updateFields = [];
    const updateParams = [];
    for (const [key, value] of Object.entries(input)) {
        updateFields.push(`${key} = ?`);
        updateParams.push(value);
    }
    
    if (updateFields.length > 0) {
        const [result] = await db.query(
            `UPDATE Product SET ${updateFields.join(', ')} WHERE id = ? AND tenantId = ?`,
            [...updateParams, id, req.auth.tenantId]
        );
        if (result.affectedRows === 0)
            return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    } else {
        const [existing] = await db.query('SELECT id FROM Product WHERE id = ? AND tenantId = ?', [id, req.auth.tenantId]);
        if (existing.length === 0)
            return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    }
    
    const [updated] = await db.query('SELECT * FROM Product WHERE id = ?', [id]);
    return res.json(updated[0]);
});

productRouter.post('/:id/image', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), imageUpload.single('image'), async (req, res) => {
    if (!req.file)
        return res.status(422).json({ error: { code: 'IMAGE_REQUIRED', message: 'Choose an image to upload' } });
    const id = String(req.params.id);
    
    const [products] = await db.query(
        'SELECT p.*, f.id as f_id, f.storageKey as f_storageKey FROM Product p LEFT JOIN FileAsset f ON p.imageFileId = f.id WHERE p.id = ? AND p.tenantId = ?',
        [id, req.auth.tenantId]
    );
    const current = products[0];
    if (!current)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
        
    const stored = await uploadPermanentImage(req.file, req.auth.tenantId, 'products');
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        const fileId = randomUUID();
        await connection.query(
            'INSERT INTO FileAsset (id, tenantId, uploadedById, originalName, storageKey, storageProvider, publicUrl, mimeType, sizeBytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [fileId, req.auth.tenantId, req.auth.sub, stored.originalName, stored.storageKey, 'LOCAL', stored.publicUrl, stored.mimeType, stored.sizeBytes]
        );
        
        await connection.query('UPDATE Product SET imageUrl = ?, imageFileId = ? WHERE id = ?', [stored.publicUrl, fileId, id]);
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId) VALUES (?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, current.imageFileId ? 'PRODUCT_IMAGE_REPLACED' : 'PRODUCT_IMAGE_ADDED', 'Product', id]
        );
        
        if (current.imageFileId) {
            await connection.query('DELETE FROM FileAsset WHERE id = ?', [current.imageFileId]);
        }
        
        const [resQuery] = await connection.query('SELECT * FROM Product WHERE id = ?', [id]);
        updated = resQuery[0];
        
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        await deletePermanentImage(stored.storageKey).catch(() => undefined);
        throw error;
    } finally {
        connection.release();
    }
    
    await deletePermanentImage(current.f_storageKey).catch(() => undefined);
    return res.json(updated);
});

productRouter.delete('/:id/image', authorize(Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER), async (req, res) => {
    const id = String(req.params.id);
    
    const [products] = await db.query(
        'SELECT p.*, f.id as f_id, f.storageKey as f_storageKey FROM Product p LEFT JOIN FileAsset f ON p.imageFileId = f.id WHERE p.id = ? AND p.tenantId = ?',
        [id, req.auth.tenantId]
    );
    const current = products[0];
    if (!current)
        return res.status(404).json({ error: { code: 'NOT_FOUND' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('UPDATE Product SET imageUrl = NULL, imageFileId = NULL WHERE id = ?', [id]);
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId) VALUES (?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'PRODUCT_IMAGE_DELETED', 'Product', id]
        );
        
        if (current.imageFileId) {
            await connection.query('DELETE FROM FileAsset WHERE id = ?', [current.imageFileId]);
        }
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    await deletePermanentImage(current.f_storageKey).catch(() => undefined);
    return res.status(204).end();
});
