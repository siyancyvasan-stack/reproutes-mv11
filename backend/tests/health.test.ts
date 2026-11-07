import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
});

describe('health endpoint', () => {
  it('returns API and dependency health without exposing secrets', async () => {
    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('reproutes-api');
    expect(response.body.dependencies.redis.status).toBe('disabled');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });

  it('reports database readiness', async () => {
    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.dependencies.redis.status).toBe('disabled');
  });

  it('returns 503 readiness without exposing connection details', async () => {
    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });
});
