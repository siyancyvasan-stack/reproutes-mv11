import { useEffect, useRef, useState } from 'react';
import { Agent, AgentStatus, Geofence, LocationPermission, RoutePoint } from '../types';
import { io } from 'socket.io-client';
import { apiRequest, ensureAccessToken, getAccessToken, refreshSessionAccessToken } from '../services/apiClient';
import { withDerivedTrackingStatus } from '../services/trackingStatus';

type TelemetryMessage = {
  type?: string;
  agentId?: string;
  id?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  heading?: number;
  altitude?: number;
  accuracy?: number;
  gpsAccuracyMeters?: number;
  speed?: number;
  speedKmH?: number;
  battery?: number;
  batteryLevel?: number;
  status?: AgentStatus;
  currentLocation?: string;
  timestamp?: string;
  deviceTimestamp?: string;
  serverReceivedAt?: string;
  lastUpdatedAt?: string;
  presenceAt?: string;
  shiftActive?: boolean;
  socketConnected?: boolean;
  lastHeartbeatAt?: string;
  lastLocationAt?: string;
  locationPermission?: LocationPermission;
  trackingState?: Agent['trackingState'];
  trackingStateAt?: string;
  idleStatus?: Agent['idleStatus'];
  idleSince?: string;
  lastMovementAt?: string;
  idleAlert?: Agent['idleAlert'];
  distanceKm?: number;
  workDistanceKm?: number;
  breakDistanceKm?: number;
  gpsCoverage?: number;
  travelledPath?: RoutePoint[];
  routeCoordinates?: RoutePoint[];
  destination?: RoutePoint;
  etaMinutes?: number;
  remainingDistanceKm?: number;
  geofences?: Geofence[];
};

export type TrackingConnectionState = 'demo' | 'connecting' | 'live' | 'reconnecting' | 'offline';

const refreshTrackingStatuses = (agents: Agent[]) => agents.map((agent) => withDerivedTrackingStatus(agent));

const toFiniteCoordinate = (value: unknown): number | undefined => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
};

const isFiniteCoordinate = (value: unknown): value is number =>
  toFiniteCoordinate(value) !== undefined;

const toMessages = (payload: unknown): TelemetryMessage[] => {
  if (Array.isArray(payload)) return payload as TelemetryMessage[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.agents)) return record.agents as TelemetryMessage[];
    if (record.data && typeof record.data === 'object') return [record.data as TelemetryMessage];
    return [payload as TelemetryMessage];
  }
  return [];
};

export const useLiveAgentTracking = (initialAgents: Agent[]) => {
  const [agents, setAgents] = useState(() => refreshTrackingStatuses(initialAgents));
  const socketUrl = (import.meta.env.VITE_TRACKING_WS_URL as string | undefined)?.trim();
  // Same-origin is the production topology. Do not fall back to demo mode
  // merely because the frontend was built without a tracking env var.
  const configuredSocketIoUrl =
    ((import.meta.env.VITE_TRACKING_SOCKET_URL as string | undefined)?.trim() ||
      (import.meta.env.VITE_API_URL as string | undefined)?.trim() || 'same-origin');
  const socketIoUrl =
    configuredSocketIoUrl === 'same-origin' ? undefined : configuredSocketIoUrl;
  const [connectionState, setConnectionState] = useState<TrackingConnectionState>(
    socketUrl || configuredSocketIoUrl ? 'connecting' : 'demo',
  );
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    setAgents((current) =>
      initialAgents.map((directoryAgent) => {
        const liveAgent = current.find((agent) => agent.id === directoryAgent.id);
        if (!liveAgent) return withDerivedTrackingStatus(directoryAgent);
        return withDerivedTrackingStatus({
          ...directoryAgent,
          ...liveAgent,
          name: directoryAgent.name,
          email: directoryAgent.email,
          employeeCode: directoryAgent.employeeCode,
          avatar: directoryAgent.avatar,
          phone: directoryAgent.phone,
          routeAssigned: directoryAgent.routeAssigned,
          vehicleNo: directoryAgent.vehicleNo,
        });
      }),
    );
  }, [initialAgents]);

  useEffect(() => {
    if (!configuredSocketIoUrl) return;
    void apiRequest<{ agents: TelemetryMessage[] }>('/api/v1/tracking/latest')
      .then((payload) => {
        setAgents((current) => mergeTelemetry(current, payload.agents, new Date().toISOString()));
      })
      .catch(() => undefined);
  }, [configuredSocketIoUrl]);

  // Polling is a safety net alongside Socket.IO to guarantee live tracking
  // remains continuously up-to-date even if websockets are delayed.
  useEffect(() => {
    if (!configuredSocketIoUrl) return;
    const timer = window.setInterval(() => {
      void apiRequest<{ agents: TelemetryMessage[] }>('/api/v1/tracking/latest')
        .then((payload) => setAgents((current) => mergeTelemetry(current, payload.agents, new Date().toISOString())))
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [configuredSocketIoUrl]);

  useEffect(() => {
    if (!configuredSocketIoUrl) return;
    let disposed = false;
    let socket: ReturnType<typeof io> | undefined;
    let refreshingSocketToken = false;
    let keepAliveTimer: number | undefined;
    setConnectionState('connecting');

    const resyncSnapshot = () => apiRequest<{ agents: TelemetryMessage[] }>('/api/v1/tracking/latest')
      .then((payload) => {
        if (!disposed) setAgents((current) => mergeTelemetry(current, payload.agents, new Date().toISOString()));
      })
      .catch(() => undefined);

    const recoverConnection = () => {
      if (disposed) return;
      if (socket && !socket.connected && navigator.onLine) socket.connect();
      void resyncSnapshot();
    };

    void ensureAccessToken()
      .then(() => {
        if (disposed) return;
        socket = io(socketIoUrl, {
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
        socket.on('connect', () => {
          setConnectionState('live');
          void resyncSnapshot();
        });
        socket.on('disconnect', () => {
          setConnectionState(navigator.onLine ? 'reconnecting' : 'offline');
          if (navigator.onLine) {
            socket?.connect();
          }
        });
        socket.on('connect_error', (error) => {
          setConnectionState(navigator.onLine ? 'reconnecting' : 'offline');
          if (refreshingSocketToken || !/auth|token|unauth/i.test(error.message)) return;
          refreshingSocketToken = true;
          void refreshSessionAccessToken().then((token) => {
            if (disposed || !socket) return;
            socket.auth = { token };
            socket.connect();
          }).catch(() => setConnectionState('offline')).finally(() => {
            refreshingSocketToken = false;
          });
        });
        socket.on('tracking:agent-location', (message: TelemetryMessage) => {
          setConnectionState('live');
          setAgents((current) => mergeTelemetry(current, [message], new Date().toISOString()));
        });
      })
      .catch(() => {
        if (!disposed) setConnectionState('offline');
      });

    // Keepalive watchdog timer
    keepAliveTimer = window.setInterval(() => {
      if (disposed) return;
      if (socket && !socket.connected && navigator.onLine) {
        socket.connect();
      }
    }, 5_000);

    window.addEventListener('online', recoverConnection);
    window.addEventListener('focus', recoverConnection);
    window.addEventListener('pageshow', recoverConnection);
    document.addEventListener('visibilitychange', recoverConnection);

    return () => {
      disposed = true;
      if (keepAliveTimer !== undefined) window.clearInterval(keepAliveTimer);
      window.removeEventListener('online', recoverConnection);
      window.removeEventListener('focus', recoverConnection);
      window.removeEventListener('pageshow', recoverConnection);
      document.removeEventListener('visibilitychange', recoverConnection);
      socket?.disconnect();
    };
  }, [configuredSocketIoUrl, socketIoUrl]);

  useEffect(() => {
    if (configuredSocketIoUrl) return;
    if (!socketUrl) return;

    let socket: WebSocket | undefined;
    let reconnectTimer = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConnectionState(reconnectAttempt.current ? 'reconnecting' : 'connecting');

      try {
        socket = new WebSocket(socketUrl);
      } catch {
        setConnectionState('offline');
        return;
      }

      socket.addEventListener('open', () => {
        reconnectAttempt.current = 0;
        setConnectionState('live');
      });

      socket.addEventListener('message', (event) => {
        try {
          const messages = toMessages(JSON.parse(event.data as string));
          setAgents((current) => mergeTelemetry(current, messages, new Date().toISOString()));
        } catch {
          // Ignore malformed frames without interrupting subsequent live telemetry.
        }
      });

      socket.addEventListener('close', () => {
        if (disposed) return;
        reconnectAttempt.current += 1;
        setConnectionState('reconnecting');
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt.current, 5));
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener('error', () => socket?.close());
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [configuredSocketIoUrl, socketUrl]);

  useEffect(() => {
    const freshnessTimer = window.setInterval(() => {
      setAgents((current) => refreshTrackingStatuses(current));
    }, 15_000);
    return () => window.clearInterval(freshnessTimer);
  }, []);

  return { agents, connectionState };
};

const mergeTelemetry = (
  current: Agent[],
  messages: TelemetryMessage[],
  managerDisplayedAt: string,
) =>
  current.map((agent) => {
              const telemetry = messages.find((item) => (item.agentId ?? item.id) === agent.id);
              if (!telemetry) return agent;

              const lat = toFiniteCoordinate(telemetry.latitude ?? telemetry.lat) ?? Number.NaN;
              const lng = toFiniteCoordinate(telemetry.longitude ?? telemetry.lng) ?? Number.NaN;
              const hasCoordinates =
                Number.isFinite(lat) &&
                Number.isFinite(lng) &&
                lat >= -90 &&
                lat <= 90 &&
                lng >= -180 &&
                lng <= 180 &&
                !(lat === 0 && lng === 0);
              // Punch-in and the profile snapshot can contain coordinates with
              // only lastLocationAt/serverReceivedAt. Treat those as valid
              // location timestamps; otherwise the map silently keeps NaN.
              const incomingTimestamp = telemetry.deviceTimestamp ?? telemetry.lastUpdatedAt ?? telemetry.timestamp ?? telemetry.lastLocationAt ?? telemetry.serverReceivedAt;
              const timestamp = incomingTimestamp ?? agent.deviceRecordedAt ?? agent.lastUpdatedAt;
              const isNewerLocation = Boolean(incomingTimestamp) && (
                !agent.deviceRecordedAt || new Date(incomingTimestamp!).getTime() > new Date(agent.deviceRecordedAt).getTime()
              );
              const heartbeatTimestamp = telemetry.lastHeartbeatAt ?? telemetry.presenceAt ?? agent.lastHeartbeatAt ?? agent.lastPresenceAt;
              const incomingLocationTimestamp = telemetry.lastLocationAt;
              const locationTimestamp = incomingLocationTimestamp && (
                !agent.lastLocationAt || new Date(incomingLocationTimestamp).getTime() > new Date(agent.lastLocationAt).getTime()
              ) ? incomingLocationTimestamp : agent.lastLocationAt ?? timestamp;
              const displayDelayMs = timestamp
                ? Math.max(0, new Date(managerDisplayedAt).getTime() - new Date(timestamp).getTime())
                : undefined;
              const nextPoint: RoutePoint | undefined = hasCoordinates && incomingTimestamp
                ? { lat, lng, timestamp }
                : undefined;
              const existingPath = telemetry.travelledPath ?? agent.travelledPath ?? [];
              const travelledPathUnsorted =
                nextPoint &&
                !existingPath.some((point) => point.timestamp === nextPoint.timestamp)
                  ? [...existingPath, nextPoint]
                  : existingPath;
              const travelledPath = [...travelledPathUnsorted].sort((a, b) =>
                new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime());

              const merged: Agent = {
                ...agent,
                ...(hasCoordinates && (isNewerLocation || !isValidAgentCoordinate(agent.coordinates))
                  ? { coordinates: { lat, lng } }
                  : {}),
                ...(telemetry.heading !== undefined ? { heading: telemetry.heading } : {}),
                ...(telemetry.altitude !== undefined ? { altitude: telemetry.altitude } : {}),
                ...(telemetry.accuracy !== undefined || telemetry.gpsAccuracyMeters !== undefined
                  ? { gpsAccuracyMeters: telemetry.gpsAccuracyMeters ?? telemetry.accuracy }
                  : {}),
                ...(telemetry.speed !== undefined || telemetry.speedKmH !== undefined
                  ? { speedKmH: telemetry.speedKmH ?? telemetry.speed }
                  : {}),
                ...(telemetry.battery !== undefined || telemetry.batteryLevel !== undefined
                  ? { batteryLevel: telemetry.batteryLevel ?? telemetry.battery }
                  : {}),
                ...(telemetry.status ? { status: telemetry.status } : {}),
                ...(telemetry.currentLocation ? { currentLocation: telemetry.currentLocation } : {}),
                ...(travelledPath.length ? { travelledPath } : {}),
                ...(telemetry.routeCoordinates ? { routeCoordinates: telemetry.routeCoordinates } : {}),
                ...(telemetry.destination ? { destination: telemetry.destination } : {}),
                ...(telemetry.etaMinutes !== undefined ? { etaMinutes: telemetry.etaMinutes } : {}),
                ...(telemetry.remainingDistanceKm !== undefined
                  ? { remainingDistanceKm: telemetry.remainingDistanceKm }
                  : {}),
                ...(telemetry.geofences ? { geofences: telemetry.geofences } : {}),
                ...(incomingTimestamp && isNewerLocation ? { lastUpdatedAt: incomingTimestamp, deviceRecordedAt: incomingTimestamp } : {}),
                ...(telemetry.serverReceivedAt ? { serverReceivedAt: telemetry.serverReceivedAt } : {}),
                ...(timestamp ? {
                  managerDisplayedAt,
                  managerDisplayDelayMs: displayDelayMs,
                } : {}),
                ...(heartbeatTimestamp ? { lastHeartbeatAt: heartbeatTimestamp, lastPresenceAt: heartbeatTimestamp } : {}),
                ...(locationTimestamp ? { lastLocationAt: locationTimestamp } : {}),
                ...(telemetry.shiftActive !== undefined ? { shiftActive: telemetry.shiftActive } : {}),
                ...(telemetry.socketConnected !== undefined ? { socketConnected: telemetry.socketConnected } : {}),
                ...(telemetry.locationPermission ? { locationPermission: telemetry.locationPermission } : {}),
                ...(telemetry.trackingState ? { trackingState: telemetry.trackingState } : {}),
                ...(telemetry.trackingStateAt ? { trackingStateAt: telemetry.trackingStateAt } : {}),
                ...(telemetry.idleStatus ? { idleStatus: telemetry.idleStatus } : {}),
                ...(telemetry.idleSince ? { idleSince: telemetry.idleSince } : {}),
                ...(telemetry.lastMovementAt ? { lastMovementAt: telemetry.lastMovementAt } : {}),
                ...(telemetry.idleAlert ? { idleAlert: telemetry.idleAlert } : {}),
                ...(telemetry.distanceKm !== undefined ? { distanceKm: telemetry.distanceKm } : {}),
                ...(telemetry.workDistanceKm !== undefined ? { workDistanceKm: telemetry.workDistanceKm } : {}),
                ...(telemetry.breakDistanceKm !== undefined ? { breakDistanceKm: telemetry.breakDistanceKm } : {}),
                ...(telemetry.gpsCoverage !== undefined ? { gpsCoverage: telemetry.gpsCoverage } : {}),
              };
              return withDerivedTrackingStatus(merged);
            });

const isValidAgentCoordinate = (coordinates?: { lat?: number; lng?: number }) =>
  Boolean(coordinates && toFiniteCoordinate(coordinates.lat) !== undefined && toFiniteCoordinate(coordinates.lng) !== undefined &&
    coordinates.lat >= -90 && coordinates.lat <= 90 && coordinates.lng >= -180 && coordinates.lng <= 180 &&
    !(coordinates.lat === 0 && coordinates.lng === 0));
