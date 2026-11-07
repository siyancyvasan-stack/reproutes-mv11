import { describe, expect, it } from 'vitest';
import { ATTENDANCE_GPS_MAX_ACCURACY_METERS, ATTENDANCE_GPS_TIMEOUT_MS } from '../src/modules/attendance/attendance.policy.js';

describe('attendance GPS policy', () => {
  it('uses the checkout contract values', () => {
    expect(ATTENDANCE_GPS_TIMEOUT_MS).toBe(20_000);
    expect(ATTENDANCE_GPS_MAX_ACCURACY_METERS).toBe(100);
  });
});
