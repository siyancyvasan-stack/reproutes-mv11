import type { QueuedGpsPoint } from './gpsQueue';

export const uploadCheckoutGpsBestEffort = async (
  point: QueuedGpsPoint,
  upload: (value: QueuedGpsPoint) => Promise<void>,
) => {
  try {
    await upload(point);
    return true;
  } catch {
    return false;
  }
};
