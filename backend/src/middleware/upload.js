import path from 'node:path';
import multer from 'multer';
import { uploadObject } from '../modules/files/object-storage.service.js';
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const objectStorage = {
    _handleFile: (req, file, callback) => {
        const chunks = [];
        file.stream.on('data', (chunk) => chunks.push(chunk));
        file.stream.once('error', callback);
        file.stream.once('end', () => {
            const buffer = Buffer.concat(chunks);
            const auth = req.auth;
            if (!auth)
                return callback(new Error('Authenticated upload required'));
            void uploadObject({ tenantId: auth.tenantId, folder: 'files', originalName: file.originalname, mimeType: file.mimetype, buffer })
                .then(({ storageKey, sizeBytes }) => callback(null, { filename: storageKey, path: storageKey, size: sizeBytes, buffer }))
                .catch(callback);
        });
    },
    _removeFile: (_req, _file, callback) => callback(null),
};
export const upload = multer({
    storage: objectStorage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, allowedTypes.has(file.mimetype)),
});
export const avatarUpload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => allowedImageTypes.has(file.mimetype) ? callback(null, true) : callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'avatar')),
});
export const imageUpload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, callback) => {
        const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
        if (!allowedImageTypes.has(file.mimetype) || !allowedExtensions.has(path.extname(file.originalname).toLowerCase()))
            return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
        callback(null, true);
    },
});
