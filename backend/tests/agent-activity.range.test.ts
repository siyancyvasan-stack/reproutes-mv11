import { describe, expect, it } from 'vitest';
import { parseActivityRange } from '../src/modules/agents/agent-activity.service.js';

describe('agent activity calendar ranges', () => {
  it('uses the tenant Asia/Colombo day boundary', () => {
    const range = parseActivityRange('2026-08-15', '2026-08-15', 'Asia/Colombo');
    expect(range.from.toISOString()).toBe('2026-08-14T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-08-15T18:30:00.000Z');
  });

  it('uses UTC boundaries for UTC tenants', () => {
    const range = parseActivityRange('2026-08-15', '2026-08-16', 'UTC');
    expect(range.from.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('rejects reversed and excessive ranges', () => {
    expect(() => parseActivityRange('2026-08-16', '2026-08-15')).toThrow('INVALID_ACTIVITY_RANGE');
    expect(() => parseActivityRange('2025-01-01', '2026-08-15')).toThrow('INVALID_ACTIVITY_RANGE');
  });
});
