import type { QueuedGpsPoint } from './gpsQueue';

export const PREFERRED_GPS_ACCURACY_METERS = 65;
export const GPS_TIMEOUT_MS = 10_000;
export const MAXIMUM_GPS_ACCURACY_METERS = 300;

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

  // Trigger immediate query in parallel for fast lock
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
      if (position.coords.accuracy <= PREFERRED_GPS_ACCURACY_METERS) finish(position);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: Math.min(timeout, 4_000) }
  );

  if (settled) {
    navigator.geolocation.clearWatch(watchId);
    return;
  }
  timer = globalThis.setTimeout(() => {
    if (best) return finish(best);
    finish(undefined, new GpsError(
      'TIMEOUT',
      'Unable to acquire GPS location. Please ensure location is enabled.',
      best?.coords.accuracy,
    ));
  }, timeout);
});

export const capturePreciseGpsPoint = async (agentId: string, timeout = GPS_TIMEOUT_MS): Promise<QueuedGpsPoint> => {
  const best = await requestBestPosition(timeout);
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

// Registration only needs the phone's current usable position. Prefer the
// browser's cached fix so the button responds immediately instead of waiting
// for a fresh high-accuracy GPS lock.
export const captureFastGpsPoint = async (agentId: string): Promise<QueuedGpsPoint> => {
  if (!('geolocation' in navigator)) {
    throw new GpsError('UNAVAILABLE', 'Unable to determine your current location.');
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 30_000,
      timeout: 2_000,
    });
  }).catch(() => requestBestPosition(3_000));
  const { coords } = position;
  const capturedAt = new Date(position.timestamp).toISOString();
  return {
    clientPointId: crypto.randomUUID(), agentId,
    latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
    speedKmH: coords.speed == null ? undefined : Math.max(0, Math.min(300, coords.speed * 3.6)),
    heading: coords.heading == null ? undefined : Math.max(0, Math.min(360, coords.heading)),
    altitude: coords.altitude == null ? undefined : Math.max(-500, Math.min(10_000, coords.altitude)),
    capturedAt, deviceTimestamp: capturedAt,
  };
};
