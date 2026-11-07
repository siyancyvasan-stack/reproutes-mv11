import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { AppError } from '../../middleware/errorHandler.js';
import { LOCAL_STORAGE_DIR } from './object-storage.service.js';

const formats = new Set(['jpeg', 'png', 'webp']);

export const uploadPermanentImage = async (file, tenantId, entity) => {
    const metadata = await sharp(file.buffer).metadata().catch(() => null);
    if (!metadata?.format || !formats.has(metadata.format)) {
        throw new AppError(422, 'INVALID_IMAGE', 'Upload a valid JPG, PNG, or WebP image');
    }
    const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
    const storageKey = `${tenantId}/${entity}/${randomUUID()}.${extension}`;
    
    const dest = path.join(LOCAL_STORAGE_DIR, storageKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    
    try {
        await fs.writeFile(dest, file.buffer);
    } catch {
        throw new AppError(502, 'IMAGE_UPLOAD_FAILED', 'The image could not be stored permanently');
    }
    
    return { originalName: path.basename(file.originalname), storageKey, mimeType: file.mimetype, sizeBytes: file.size, publicUrl: `/media/${storageKey}` };
};

export const deletePermanentImage = async (storageKey) => {
    if (!storageKey) return;
    try {
        await fs.rm(path.join(LOCAL_STORAGE_DIR, storageKey), { force: true });
    } catch {
        throw new AppError(502, 'IMAGE_DELETE_FAILED', 'The stored image could not be deleted');
    }
};
