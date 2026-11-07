import { describe, expect, it } from 'vitest';
import { hasConfirmedMovement, hasExceededIdleThreshold, isWithinGeofence } from '../src/modules/tracking/tracking.idle.js';

describe('idle tracking rules', () => {
  const anchor = { latitude: 6.9271, longitude: 79.8612 };

  it('triggers at 60 minutes, not before', () => {
    const started = new Date('2026-08-14T08:00:00.000Z');
    expect(hasExceededIdleThreshold(started, new Date('2026-08-14T08:59:59.999Z'))).toBe(false);
    expect(hasExceededIdleThreshold(started, new Date('2026-08-14T09:00:00.000Z'))).toBe(true);
  });

  it('ignores GPS noise but resets after confirmed movement', () => {
    expect(hasConfirmedMovement(anchor, { latitude: 6.9272, longitude: 79.8612, accuracy: 20 })).toBe(false);
    expect(hasConfirmedMovement(anchor, { latitude: 6.9290, longitude: 79.8612, accuracy: 20 })).toBe(true);
  });

  it('recognizes an assigned shop within the configured radius', () => {
    expect(isWithinGeofence(anchor, { latitude: 6.9272, longitude: 79.8612 }, 100)).toBe(true);
    expect(isWithinGeofence(anchor, { latitude: 6.9290, longitude: 79.8612 }, 100)).toBe(false);
  });
});
