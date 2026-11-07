import { useEffect, useRef, useState } from 'react';
import { Socket, io } from 'socket.io-client';
import { apiRequest, ensureAccessToken, getAccessToken, refreshSessionAccessToken } from '../services/apiClient';
import { GPS_TIMEOUT_MS, MAXIMUM_GPS_ACCURACY_METERS } from '../services/deviceGps';
import { createSingleGpsWatcher, type SingleGpsWatcher } from '../services/gpsWatcher';
import {
  enqueueGpsPoint,
  listQueuedGpsPoints,
  QueuedGpsPoint,
  removeQueuedGpsPoints,
} from '../services/gpsQueue';
import { trackingLog } from '../services/trackingLog';

export type LocationPublisherState =
  | 'tracking-stopped'
  | 'requesting-permission'
  | 'gps-unavailable'
  | 'permission-denied'
  | 'gps-timeout'
  | 'poor-accuracy'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'tracking-active'
  | 'error';

// Keep the manager map live while the agent is checked in. GPS callbacks are
// still paced to avoid flooding the socket when a device emits fixes rapidly.
const MINIMUM_UPLOAD_INTERVAL_MS = 5_000;
const MINIMUM_MOVEMENT_METERS = 0;
const MAXIMUM_UPLOAD_ACCURACY_METERS = 500;
let activeImmediateUploader: ((point: QueuedGpsPoint) => Promise<void>) | undefined;

const distanceMeters = (a: GeolocationCoordinates, b: GeolocationCoordinates) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export const uploadGpsPointImmediately = async (point: QueuedGpsPoint) => {
  if (!activeImmediateUploader) throw new Error('GPS tracking connection is not active.');
  await activeImmediateUploader(point);
};

export const useAgentLocationPublisher = (
  enabled: boolean,
  agentId?: string,
  isCheckedIn: boolean = true,
) => {
  const [state, setState] = useState<LocationPublisherState>('tracking-stopped');
  const [accuracyMeters, setAccuracyMeters] = useState<number>();
  const socketRef = useRef<Socket>();

  const configuredSocketUrl = import.meta.env.VITE_TRACKING_SOCKET_URL?.trim();
  const socketUrl = configuredSocketUrl && configuredSocketUrl !== 'same-origin'
    ? configuredSocketUrl
    : ((import.meta.env.VITE_API_URL as string | undefined)?.trim() || undefined);

  useEffect(() => {
    let disposed = false;
    let watcher: SingleGpsWatcher | undefined;
    let hasConnected = false;
    let lastAcceptedPosition: GeolocationPosition | undefined;
    let lastUploadedAt = 0;
    let latestFixHasPoorAccuracy = false;
    let refreshingSocketToken = false;
    let uploadChain = Promise.resolve();
    let lastPermission: 'granted' | 'denied' | 'prompt' | 'unavailable' = 'prompt';
    let heartbeatTimer: number | undefined;
    let keepAliveTimer: number | undefined;

    const sendHeartbeat = async () => {
      if (!agentId || disposed) return;
      try {
        await apiRequest('/api/v1/tracking/heartbeat', {
          method: 'POST',
          body: JSON.stringify({
            permission: lastPermission,
            servicesEnabled: lastPermission === 'granted',
            appState: document.visibilityState === 'visible' ? 'active' : 'background',
          }),
        });
      } catch {
        if (!disposed && navigator.onLine && !socketRef.current?.connected) {
          setState('reconnecting');
        }
      }
    };

    const reportPermission = (permission: 'granted' | 'denied' | 'prompt' | 'unavailable') => {
      lastPermission = permission;
      socketRef.current?.emit('tracking:location-permission', { permission });
      void sendHeartbeat();
    };

    const emitBatch = (socket: Socket, points: QueuedGpsPoint[]) => new Promise<void>((resolve, reject) => {
      socket.timeout(30_000).emit('tracking:batch', points, (
        timeoutError: Error | null,
        response?: { ok?: boolean; results?: Array<{ ok: boolean; error?: string; clientPointId?: string }> },
      ) => {
        if (timeoutError || !response?.ok) return reject(timeoutError ?? new Error('GPS batch was not accepted.'));
        const completedIds = response.results
          ?.filter((result) => result.ok || ['SHIFT_NOT_ACTIVE', 'INVALID_CAPTURE_TIME', 'VALIDATION_ERROR', 'AGENT_ID_MISMATCH'].includes(result.error ?? ''))
          .map((result) => result.clientPointId).filter(Boolean) as string[];
        void removeQueuedGpsPoints(completedIds).then(() => resolve(), reject);
      });
    });

    const flushQueue = async () => {
      const socket = socketRef.current;
      if (!agentId || !socket?.connected) return;
      try {
        const queued = await listQueuedGpsPoints(agentId);
        for (let offset = 0; offset < queued.length; offset += 100) {
          await emitBatch(socket, queued.slice(offset, offset + 100));
        }
      } catch {
        // Queue flush will retry on next cycle
      }
    };

    const uploadPoint = async (point: QueuedGpsPoint) => {
      await enqueueGpsPoint(point);
      const socket = socketRef.current;
      if (!socket?.connected) {
        try {
          await apiRequest('/api/v1/tracking/points/batch', {
            method: 'POST',
            body: JSON.stringify({ points: [point] }),
          });
          await removeQueuedGpsPoints([point.clientPointId]);
          if (!disposed) setState(isCheckedIn ? 'tracking-active' : 'connected');
        } catch {
          if (!disposed) setState(navigator.onLine ? 'reconnecting' : 'offline');
        }
        return;
      }
      await flushQueue();
      if (!disposed) {
        setState(latestFixHasPoorAccuracy ? 'poor-accuracy' : (isCheckedIn ? 'tracking-active' : 'connected'));
      }
    };

    const handlePosition = (position: GeolocationPosition) => {
      if (!agentId || disposed) return;
      const { coords } = position;
      setAccuracyMeters(Math.round(coords.accuracy));
      reportPermission('granted');
      latestFixHasPoorAccuracy = coords.accuracy > MAXIMUM_GPS_ACCURACY_METERS;
      if (latestFixHasPoorAccuracy) {
        setState('poor-accuracy');
      }
      if (coords.accuracy > MAXIMUM_UPLOAD_ACCURACY_METERS) {
        return;
      }
      const now = Date.now();
      const moved = lastAcceptedPosition ? distanceMeters(lastAcceptedPosition.coords, coords) : Number.POSITIVE_INFINITY;
      if (now - lastUploadedAt < MINIMUM_UPLOAD_INTERVAL_MS && moved < MINIMUM_MOVEMENT_METERS) return;
      lastAcceptedPosition = position;
      lastUploadedAt = now;
      const capturedAt = new Date(position.timestamp).toISOString();
      const point: QueuedGpsPoint = {
        clientPointId: crypto.randomUUID(), agentId,
        latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
        speedKmH: coords.speed == null ? undefined : Math.max(0, Math.min(300, coords.speed * 3.6)),
        heading: coords.heading == null || !Number.isFinite(coords.heading) ? undefined : Math.max(0, Math.min(360, coords.heading)),
        altitude: coords.altitude == null ? undefined : Math.max(-500, Math.min(10_000, coords.altitude)),
        capturedAt, deviceTimestamp: capturedAt,
      };
      uploadChain = uploadChain.then(() => uploadPoint(point)).then(() => {
        trackingLog('gps-success', { agentId, accuracyMeters: Math.round(coords.accuracy), deviceTimestamp: capturedAt });
      }).catch((error) => {
        if (!disposed) setState(socketRef.current?.connected ? (isCheckedIn ? 'tracking-active' : 'connected') : 'offline');
        trackingLog('gps-error', { agentId, message: error instanceof Error ? error.message : String(error) }, 'error');
      });
    };

    const handlePositionError = (error: GeolocationPositionError) => {
      if (disposed) return;
      if (error.code === error.PERMISSION_DENIED) {
        setState('permission-denied');
        reportPermission('denied');
      } else if (error.code === error.TIMEOUT) {
        setState('gps-timeout');
      } else {
        setState('gps-unavailable');
        reportPermission('unavailable');
      }
      trackingLog('gps-error', { agentId, code: error.code, message: error.message }, 'error');
    };

    const startPositionWatcher = () => {
      if (!('geolocation' in navigator)) {
        setState('gps-unavailable');
        reportPermission('unavailable');
        return;
      }
      const isLocalLoopback =
        window.location.hostname === 'localhost' ||
        /^127(?:\.\d{1,3}){3}$/.test(window.location.hostname) ||
        window.location.hostname === '[::1]';
      if (!window.isSecureContext && !isLocalLoopback) {
        trackingLog('gps-error', { agentId, message: 'Live GPS requires HTTPS on mobile devices.' }, 'error');
        setState('gps-unavailable');
        reportPermission('unavailable');
        return;
      }

      setState('requesting-permission');
      watcher ??= createSingleGpsWatcher(navigator.geolocation, handlePosition, handlePositionError, {
        enableHighAccuracy: true,
        maximumAge: 2_000,
        timeout: GPS_TIMEOUT_MS,
      });
      watcher.start();
    };

    const restartPositionWatcher = () => {
      watcher?.restart();
    };

    const recoverConnection = () => {
      if (disposed) return;
      const socket = socketRef.current;
      if (socket && !socket.connected && navigator.onLine) {
        socket.connect();
      }
      void flushQueue();
      void sendHeartbeat();
    };

    const handleOnline = () => {
      recoverConnection();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (isCheckedIn) restartPositionWatcher();
      recoverConnection();
    };

    const stop = () => {
      watcher?.stop();
      watcher = undefined;
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      if (keepAliveTimer !== undefined) window.clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
      socketRef.current?.disconnect();
      socketRef.current = undefined;
      if (activeImmediateUploader === uploadPoint) activeImmediateUploader = undefined;
      setState('tracking-stopped');
    };

    if (!enabled || !agentId) {
      stop();
      return;
    }

    // Attach immediate uploader and network listeners
    activeImmediateUploader = uploadPoint;
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', recoverConnection);
    window.addEventListener('pageshow', recoverConnection);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial heartbeats
    void sendHeartbeat();
    heartbeatTimer = window.setInterval(() => void sendHeartbeat(), 10_000);

    // Watchdog keepalive timer: ensures socket remains connected to live server
    keepAliveTimer = window.setInterval(() => {
      if (disposed) return;
      const socket = socketRef.current;
      if (socket && !socket.connected && navigator.onLine) {
        socket.connect();
      }
    }, 5_000);

    // Start GPS watcher if agent is checked in
    if (isCheckedIn) {
      startPositionWatcher();
    } else {
      setState('connected');
    }

    // Connect socket to live server with persistent reconnection
    void ensureAccessToken().then(() => {
      if (disposed) return;
      const socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        auth: (callback) => {
          void ensureAccessToken()
            .then((token) => callback({ token: token ?? getAccessToken() ?? undefined }))
            .catch(() => callback({ token: getAccessToken() ?? undefined }));
        },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 5_000,
        timeout: 20_000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        if (disposed) return;
        setState(isCheckedIn ? 'tracking-active' : 'connected');
        if (hasConnected) trackingLog('socket-reconnect', { agentId, socketId: socket.id });
        hasConnected = true;
        void flushQueue();
      });

      socket.on('disconnect', (reason) => {
        if (!disposed) setState(navigator.onLine ? 'reconnecting' : 'offline');
        trackingLog('socket-disconnect', { agentId, reason }, 'warn');
        if (navigator.onLine) {
          socket.connect();
        }
      });

      socket.on('connect_error', (error) => {
        if (!disposed) setState(navigator.onLine ? 'reconnecting' : 'offline');
        if (refreshingSocketToken || !/auth|token|unauth/i.test(error.message)) return;
        refreshingSocketToken = true;
        void refreshSessionAccessToken().then((token) => {
          if (disposed) return;
          socket.auth = { token };
          socket.connect();
        }).catch(() => setState('offline')).finally(() => {
          refreshingSocketToken = false;
        });
      });
    }).catch(() => {
      if (!disposed) setState('offline');
    });

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', recoverConnection);
      window.removeEventListener('pageshow', recoverConnection);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stop();
    };
  }, [agentId, configuredSocketUrl, enabled, isCheckedIn, socketUrl]);

  return { state, accuracyMeters, poorAccuracyThresholdMeters: MAXIMUM_GPS_ACCURACY_METERS };
};
