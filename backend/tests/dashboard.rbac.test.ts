import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string, values: string[]) => {
    const roleById = {
      'factory-user': 'FACTORY_MANAGER',
      'MANAGER-user': 'MANAGER',
      'AGENT-user': 'AGENT',
    } as const;
    const role = roleById[values[0] as keyof typeof roleById];
    return role
      ? [[{ id: values[0], tenantId: values[1], role, email: `${role.toLowerCase()}@example.com` }]]
      : [[]];
  }),
}));

vi.mock('../src/lib/db.js', () => ({ default: { query } }));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
});

describe('dashboard role boundaries', () => {
  it('rejects factory managers from manager analytics and order APIs', async () => {
    const [{ createApp }, { signAccessToken }] = await Promise.all([import('../src/app.js'), import('../src/lib/jwt.js')]);
    const token = signAccessToken({ sub: 'factory-user', tenantId: 'tenant-a', role: 'FACTORY_MANAGER', email: 'factory@example.com' });
    const authorization = `Bearer ${token}`;
    expect((await request(createApp()).get('/api/v1/analytics/dashboard').set('Authorization', authorization)).status).toBe(403);
    expect((await request(createApp()).patch('/api/v1/orders/test-order/status').set('Authorization', authorization).send({ status: 'APPROVED' })).status).toBe(403);
  });

  it('rejects managers and agents from factory APIs', async () => {
    const [{ createApp }, { signAccessToken }] = await Promise.all([import('../src/app.js'), import('../src/lib/jwt.js')]);
    for (const role of ['MANAGER', 'AGENT'] as const) {
      const token = signAccessToken({ sub: `${role}-user`, tenantId: 'tenant-a', role, email: `${role.toLowerCase()}@example.com` });
      expect((await request(createApp()).get('/api/v1/factory/dashboard').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    }
  });
});
