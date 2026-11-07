import type { QueuedGpsPoint } from './gpsQueue';

export const PREFERRED_GPS_ACCURACY_METERS = 30;
export const GPS_TIMEOUT_MS = 20_000;
export const MAXIMUM_GPS_ACCURACY_METERS = 100;

const getBatteryLevel = async () => {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
  try {
    const battery = await nav.getBattery?.();
    return battery ? Math.round(battery.level * 100) : undefined;
  } catch {
    return undefined;
  }
};

export class GpsError extends Error {
  constructor(public code: 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'POOR_ACCURACY', message: string, public accuracy?: number) {
    super(message);
    this.name = 'GpsError';
  }
}

export const requestBestPosition = (timeout = GPS_TIMEOUT_MS) => new Promise<GeolocationPosition>((resolve, reject) => {
  if (!('geolocation' in navigator)) return reject(new GpsError('UNAVAILABLE', 'Unable to determine your current location.'));
  let best: GeolocationPosition | undefined;
  let settled = false;
  let watchId: number | undefined;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const finish = (position?: GeolocationPosition, error?: GpsError) => {
    if (settled) return;
    settled = true;
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    if (timer !== undefined) globalThis.clearTimeout(timer);
    if (position) resolve(position);
    else reject(error ?? new GpsError('UNAVAILABLE', 'Unable to determine your current location.'));
  };
  watchId = navigator.geolocation.watchPosition((position) => {
    if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
    if (position.coords.accuracy <= PREFERRED_GPS_ACCURACY_METERS) finish(position);
  }, (error) => {
    if (error.code === error.PERMISSION_DENIED) {
      finish(undefined, new GpsError('PERMISSION_DENIED', 'Location permission denied. Please allow location access.'));
    } else if (error.code !== error.TIMEOUT) {
      finish(undefined, new GpsError('UNAVAILABLE', 'Unable to determine your current location.'));
    }
  }, { enableHighAccuracy: true, maximumAge: 5_000, timeout });
  if (settled) {
    navigator.geolocation.clearWatch(watchId);
    return;
  }
  timer = globalThis.setTimeout(() => {
    if (best && best.coords.accuracy <= MAXIMUM_GPS_ACCURACY_METERS) return finish(best);
    finish(undefined, new GpsError(
      best ? 'POOR_ACCURACY' : 'TIMEOUT',
      best
        ? 'GPS accuracy is currently too low. Please move to an area with better GPS signal.'
        : 'Unable to get your location within 20 seconds.',
      best?.coords.accuracy,
    ));
  }, timeout);
});

export const capturePreciseGpsPoint = async (agentId: string): Promise<QueuedGpsPoint> => {
  const best = await requestBestPosition();
  const capturedAt = new Date(best.timestamp).toISOString();
  return {
    clientPointId: crypto.randomUUID(),
    agentId,
    latitude: best.coords.latitude,
    longitude: best.coords.longitude,
    accuracy: best.coords.accuracy,
    speedKmH: best.coords.speed == null ? undefined : Math.max(0, Math.min(300, best.coords.speed * 3.6)),
    heading: best.coords.heading == null ? undefined : Math.max(0, Math.min(360, best.coords.heading)),
    altitude: best.coords.altitude == null ? undefined : Math.max(-500, Math.min(10_000, best.coords.altitude)),
    battery: await getBatteryLevel(),
    capturedAt,
    deviceTimestamp: capturedAt,
  };
};
