import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../src/lib/db.js', () => ({ default: { query } }));

import { consumePasskeyChallenge, savePasskeyChallenge } from '../src/modules/auth/passkey.routes.js';

describe('passkey challenge lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores a registration challenge with user binding and a five-minute expiry', async () => {
    query.mockResolvedValueOnce([{}]);
    const before = Date.now();
    await savePasskeyChallenge('unpredictable-server-challenge', 'REGISTER', 'user-1');
    const [, values] = query.mock.calls[0]!;
    expect(values[1]).toBe('unpredictable-server-challenge');
    expect(values[2]).toBe('REGISTER');
    expect(values[3]).toBe('user-1');
    expect(values[4].getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);
  });

  it('consumes a valid challenge exactly once', async () => {
    query.mockResolvedValueOnce([[{ id: 'flow-1', challenge: 'challenge-1' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(consumePasskeyChallenge('flow-1', 'LOGIN')).resolves.toBe('challenge-1');
    expect(query.mock.calls[0]![0]).toContain('consumedAt IS NULL AND expiresAt > NOW()');
    expect(query.mock.calls[1]![0]).toContain('UPDATE PasskeyChallenge SET consumedAt = NOW()');
  });

  it('rejects expired, missing, and replayed challenges', async () => {
    query.mockResolvedValueOnce([[]]);
    await expect(consumePasskeyChallenge('expired', 'LOGIN')).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
    query.mockResolvedValueOnce([[{ id: 'flow-1', challenge: 'challenge-1' }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(consumePasskeyChallenge('flow-1', 'LOGIN')).rejects.toMatchObject({ code: 'CHALLENGE_USED' });
  });

  it('binds registration challenge lookup to the authenticated user', async () => {
    query.mockResolvedValueOnce([[]]);
    await expect(consumePasskeyChallenge('flow-1', 'REGISTER', 'user-1')).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
    expect(query.mock.calls[0]![0]).toContain('AND userId = ?');
    expect(query.mock.calls[0]![1]).toEqual(['flow-1', 'REGISTER', 'user-1']);
  });
});
