import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => {
  const connection = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  return { connection, query: vi.fn(), getConnection: vi.fn(async () => connection), emit: vi.fn() };
});
vi.mock('../src/lib/db.js', () => ({ default: { query: mocks.query, getConnection: mocks.getConnection } }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.auth = { sub: 'agent', tenantId: 'tenant', role: 'AGENT' }; next(); },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));
import { shopRouter } from '../src/modules/shops/shop.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const input = { name: "Sabah's shop", ownerName: 'Sabah', phone: '0752785203', address: '123 Main Street', city: 'Colombo' };
const app = express();
app.use(express.json());
app.use('/shops', shopRouter);
app.use(errorHandler);
const io = { to: vi.fn(), emit: mocks.emit };
io.to.mockReturnValue(io);
app.set('io', io);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([[]]);
  mocks.connection.query.mockImplementation(async (sql: string, values: any[]) => {
    if (sql.startsWith('INSERT')) expect((sql.match(/\?/g) ?? []).length).toBe(values.length);
    if (sql.startsWith('INSERT INTO Shop')) expect(sql).toContain('updatedAt');
    if (sql.startsWith('SELECT * FROM Shop')) return [[{ id: values[0], ...input }]];
    if (sql.startsWith('SELECT id FROM User')) return [[{ id: 'manager' }]];
    return [{ affectedRows: 1 }];
  });
});

describe('shop registration', () => {
  it('commits the shop, audit and parameterized notifications before responding 201', async () => {
    const response = await request(app).post('/shops').send(input);
    expect(response.status).toBe(201);
    expect(response.body.name).toBe(input.name);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).not.toHaveBeenCalled();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
    const notification = mocks.connection.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO Notification'))!;
    expect(notification[0]).not.toContain(input.name);
    expect(notification[1]).toContain(`${input.name} was added to the sales network.`);
    expect(mocks.emit).toHaveBeenCalledWith('sales:new-retailer', expect.objectContaining({ name: input.name }));
    expect(mocks.connection.commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.emit.mock.invocationCallOrder[0]);
  });

  it('rolls back a failed audit so retrying does not encounter a partially saved shop', async () => {
    const query = mocks.connection.query.getMockImplementation()!;
    mocks.connection.query.mockImplementation(async (sql, values) => {
      if (sql.startsWith('INSERT INTO AuditLog')) throw Object.assign(new Error('missing column'), { code: 'ER_BAD_FIELD_ERROR' });
      return query(sql, values);
    });
    const response = await request(app).post('/shops').send(input);
    expect(response.status).toBe(503);
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('rejects duplicates before starting a transaction', async () => {
    mocks.query.mockResolvedValue([[{ id: 'existing', ...input }]]);
    expect((await request(app).post('/shops').send(input)).status).toBe(409);
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
});
