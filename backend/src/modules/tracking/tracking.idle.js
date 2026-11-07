import { distanceMeters } from './tracking.metrics.js';
export const hasConfirmedMovement = (anchor, point, radiusMeters = 100) => distanceMeters(anchor, point) > Math.max(radiusMeters, point.accuracy * 1.5);
export const hasExceededIdleThreshold = (idleStartedAt, capturedAt, thresholdMinutes = 60) => capturedAt.getTime() - idleStartedAt.getTime() >= thresholdMinutes * 60_000;
export const isWithinGeofence = (point, target, radiusMeters = 100) => distanceMeters(point, target) <= radiusMeters;
