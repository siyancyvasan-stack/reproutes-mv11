export interface SingleGpsWatcher {
  start: () => void;
  restart: () => void;
  stop: () => void;
  isActive: () => boolean;
}

export const createSingleGpsWatcher = (
  geolocation: Geolocation,
  success: PositionCallback,
  error: PositionErrorCallback,
  options: PositionOptions,
): SingleGpsWatcher => {
  let watchId: number | undefined;
  const stop = () => {
    if (watchId === undefined) return;
    geolocation.clearWatch(watchId);
    watchId = undefined;
  };
  const start = () => {
    if (watchId !== undefined) return;
    watchId = geolocation.watchPosition(success, error, options);
  };
  return { start, stop, restart: () => { stop(); start(); }, isActive: () => watchId !== undefined };
};
