import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../middleware/errorHandler.js';

export const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), 'media');

const safeExtension = (name) => path.extname(path.basename(name)).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
const localPath = (storageKey) => path.join(LOCAL_STORAGE_DIR, storageKey);

export const uploadObject = async (input) => {
    const storageKey = `${input.tenantId}/${input.folder}/${randomUUID()}${safeExtension(input.originalName)}`;
    const dest = localPath(storageKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, input.buffer);
    return { storageKey, sizeBytes: input.buffer.length };
};

export const deleteObject = async (storageKey) => {
    if (!storageKey) return;
    await fs.rm(localPath(storageKey), { force: true });
};

export const createSignedDownloadUrl = async (storageKey, expiresInSeconds = 300) => {
    return `/media/${storageKey}`;
};

export const redirectToSignedObject = async (res, storageKey) => {
    const filePath = localPath(storageKey);
    try {
        await fs.access(filePath);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(filePath);
    } catch {
        throw new AppError(404, 'STORED_FILE_NOT_FOUND', 'The stored file is unavailable');
    }
};

export const createSignedUpload = async (tenantId, folder, originalName) => {
    throw new AppError(501, 'NOT_IMPLEMENTED', 'Direct signed uploads are disabled. Use the standard multipart file upload endpoint instead.');
};

export const verifyStoredObject = async (storageKey) => {
    const filePath = localPath(storageKey);
    try {
        const stat = await fs.stat(filePath);
        return { sizeBytes: stat.size, mimeType: 'application/octet-stream' };
    } catch {
        throw new AppError(422, 'UPLOAD_NOT_FOUND', 'The direct upload has not completed');
    }
};
