import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';

const responseDouble = () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { response: { status } as unknown as Response, status, json };
};

const request = { path: '/api/v1/auth/login' } as Request;

describe('database error responses', () => {
  it.each(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'])('returns an actionable 503 for schema error %s', (code) => {
    const { response, status, json } = responseDouble();
    const error = Object.assign(new Error('schema mismatch'), { code });

    errorHandler(error, request, response, vi.fn());

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'DATABASE_SCHEMA_OUTDATED',
        message: 'The database schema is not ready. Apply the pending database migrations and try again.',
      },
    });
  });

  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'])('returns 503 for connection error %s', (code) => {
    const { response, status, json } = responseDouble();
    const error = Object.assign(new Error('database unavailable'), { code });

    errorHandler(error, request, response, vi.fn());

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database service is temporarily unavailable',
      },
    });
  });
});
