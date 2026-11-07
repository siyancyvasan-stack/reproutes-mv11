import { describe, expect, it } from 'vitest';
import { severityFor } from '../src/modules/safety/safety.service.js';

describe('safety alert severity', () => {
  it('classifies emergency and tracking alerts consistently', () => {
    expect(severityFor('SOS')).toBe('CRITICAL');
    expect(severityFor('OFFLINE')).toBe('HIGH');
    expect(severityFor('LOCATION_PERMISSION_DENIED')).toBe('HIGH');
    expect(severityFor('STATIONARY')).toBe('WARNING');
    expect(severityFor('LOW_BATTERY')).toBe('WARNING');
    expect(severityFor('CHECK_IN')).toBe('INFO');
  });
});
