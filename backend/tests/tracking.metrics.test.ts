import { describe, expect, it } from 'vitest';
import { calculateTrackingMetrics, distanceMeters } from '../src/modules/tracking/tracking.metrics.js';

describe('tracking metrics', () => {
  it('ignores drift below ten metres for distance', () => {
    expect(distanceMeters({ latitude: 6.9271, longitude: 79.8612 }, { latitude: 6.92711, longitude: 79.8612 })).toBeLessThan(10);
    const start = new Date('2026-08-08T08:00:00Z');
    const metrics = calculateTrackingMetrics([
      { latitude: 6.9271, longitude: 79.8612, recordedAt: start, deviceRecordedAt: start, shiftStatus: 'WORKING' },
      { latitude: 6.92711, longitude: 79.8612, recordedAt: new Date(start.getTime() + 15_000), deviceRecordedAt: new Date(start.getTime() + 15_000), shiftStatus: 'WORKING' },
    ], start, new Date(start.getTime() + 15_000));
    expect(metrics.totalDistanceKm).toBe(0);
    expect(metrics.gpsCoverage).toBe(100);
  });

  it('separates working and break distance and detects GPS gaps', () => {
    const start = new Date('2026-08-08T08:00:00Z');
    const points = [
      { latitude: 6.9271, longitude: 79.8612, recordedAt: start, deviceRecordedAt: start, shiftStatus: 'WORKING', speedKmH: 10 },
      { latitude: 6.9281, longitude: 79.8612, recordedAt: new Date(start.getTime() + 15_000), deviceRecordedAt: new Date(start.getTime() + 15_000), shiftStatus: 'WORKING', speedKmH: 20 },
      { latitude: 6.9291, longitude: 79.8612, recordedAt: new Date(start.getTime() + 75_000), deviceRecordedAt: new Date(start.getTime() + 75_000), shiftStatus: 'ON_BREAK', speedKmH: 5 },
    ];
    const metrics = calculateTrackingMetrics(points, start, new Date(start.getTime() + 75_000));
    expect(metrics.workDistanceKm).toBeGreaterThan(0);
    expect(metrics.breakDistanceKm).toBeGreaterThan(0);
    expect(metrics.gpsDelayCount).toBe(1);
    expect(metrics.longestGpsGapSeconds).toBe(60);
    expect(metrics.maximumSpeedKmH).toBe(20);
  });
});
