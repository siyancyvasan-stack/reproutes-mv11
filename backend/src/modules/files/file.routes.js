import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { createFileAsset, toStoredUpload } from './file.service.js';
import { createSignedUpload, verifyStoredObject } from './object-storage.service.js';
import { z } from 'zod';
export const fileRouter = Router();
fileRouter.use(authenticate);
fileRouter.post('/', upload.single('file'), async (req, res) => {
    if (!req.file)
        return res.status(422).json({ error: { code: 'FILE_REQUIRED' } });
    const asset = await createFileAsset(req.auth.tenantId, req.auth.sub, toStoredUpload(req.file));
    return res.status(201).json(asset);
});
fileRouter.post('/signed-upload', async (req, res) => {
    const input = z.object({ originalName: z.string().trim().min(1).max(255), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) }).parse(req.body);
    const signed = await createSignedUpload(req.auth.tenantId, 'direct-uploads', input.originalName);
    return res.status(201).json({ ...signed, mimeType: input.mimeType, expiresInSeconds: 7200 });
});
fileRouter.post('/signed-upload/complete', async (req, res) => {
    const input = z.object({ storageKey: z.string().max(500), originalName: z.string().trim().min(1).max(255), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) }).parse(req.body);
    const prefix = `${req.auth.tenantId}/direct-uploads/`;
    if (!input.storageKey.startsWith(prefix) || input.storageKey.includes('..'))
        return res.status(403).json({ error: { code: 'INVALID_STORAGE_KEY' } });
    const stored = await verifyStoredObject(input.storageKey);
    if (stored.sizeBytes <= 0 || stored.sizeBytes > 100 * 1024 * 1024 || stored.mimeType !== input.mimeType)
        return res.status(422).json({ error: { code: 'INVALID_UPLOADED_OBJECT' } });
    const asset = await createFileAsset(req.auth.tenantId, req.auth.sub, { originalName: input.originalName, storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: stored.sizeBytes });
    return res.status(201).json(asset);
});
