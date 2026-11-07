import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
});

describe('authentication route mounting', () => {
  it('allows the public login route through without an access token', async () => {
    const { createApp } = await import('../src/app.js');
    const response = await request(createApp())
      .post('/api/v1/auth/login')
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.code).not.toBe('UNAUTHENTICATED');
  }, 15_000);

  it('still protects legacy broadcast routes', async () => {
    const { createApp } = await import('../src/app.js');
    const response = await request(createApp())
      .get('/api/manager/broadcast/history');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});
