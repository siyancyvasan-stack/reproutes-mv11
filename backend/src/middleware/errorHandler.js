import { logger } from '../config/logger.js';
import { ZodError } from 'zod';
import multer from 'multer';

export class AppError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const databaseUnavailableCodes = new Set([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR',
]);

const databaseSchemaCodes = new Set([
    'ER_NO_SUCH_TABLE',
    'ER_BAD_FIELD_ERROR',
]);

export const errorHandler = (error, req, res, _next) => {
    if (error instanceof multer.MulterError) {
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(tooLarge ? 413 : 422).json({
            error: {
                code: tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE',
                message: tooLarge
                    ? 'Images must be 5 MB or smaller'
                    : 'Upload a valid JPG, PNG, or WebP image',
            },
        });
    }
    if (error instanceof AppError) {
        return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
        return res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: error.issues[0]?.message ?? 'The request contains invalid data',
            },
        });
    }
    
    // MySQL errors
    if (error.code && databaseSchemaCodes.has(error.code)) {
        logger.error({ err: error, path: req.path }, 'Database schema is out of date');
        return res.status(503).json({
            error: {
                code: 'DATABASE_SCHEMA_OUTDATED',
                message: 'The database schema is not ready. Apply the pending database migrations and try again.',
            },
        });
    }
    
    if (error.code && databaseUnavailableCodes.has(error.code)) {
        logger.error({ err: error, path: req.path }, 'Database unavailable');
        return res.status(503).json({
            error: {
                code: 'DATABASE_UNAVAILABLE',
                message: 'The database service is temporarily unavailable',
            },
        });
    }
    
    if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            error: {
                code: 'DUPLICATE_RECORD',
                message: 'A duplicate record exists or an account with this information already exists',
            },
        });
    }
    
    logger.error({ err: error, path: req.path }, 'Unhandled request error');
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
};
