import db from '../../lib/db.js';
import { randomUUID } from 'node:crypto';

export const toStoredUpload = (file) => ({
    originalName: file.originalname,
    storageKey: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
});

export const createFileAsset = async (tenantId, uploadedById, upload, client = db) => {
    const id = randomUUID();
    await client.query(
        'INSERT INTO FileAsset (id, tenantId, uploadedById, originalName, storageKey, mimeType, sizeBytes, storageProvider, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [id, tenantId, uploadedById, upload.originalName, upload.storageKey, upload.mimeType, upload.sizeBytes, 'LOCAL']
    );
    
    const [rows] = await client.query('SELECT * FROM FileAsset WHERE id = ?', [id]);
    return rows[0];
};
