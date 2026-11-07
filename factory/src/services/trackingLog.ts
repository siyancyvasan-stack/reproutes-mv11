export type TrackingLogEvent =
  | 'check-in'
  | 'gps-start'
  | 'gps-success'
  | 'gps-error'
  | 'socket-disconnect'
  | 'socket-reconnect'
  | 'check-out'
  | 'tracking-stop';

export const trackingLog = (
  event: TrackingLogEvent,
  details: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
) => {
  if (!import.meta.env.DEV) return;
  const entry = {
    scope: 'reproutes-gps',
    event,
    loggedAt: new Date().toISOString(),
    ...details,
  };
  const labels: Record<TrackingLogEvent, string> = {
    'check-in': 'check-in completed',
    'gps-start': 'initialization started',
    'gps-success': 'position acquired',
    'gps-error': 'operation failed',
    'socket-disconnect': 'tracking socket disconnected',
    'socket-reconnect': 'tracking socket reconnected',
    'check-out': 'check-out completed',
    'tracking-stop': 'tracking stopped',
  };
  console[level](`[RepRoutes GPS] ${labels[event]}`, entry);
};
