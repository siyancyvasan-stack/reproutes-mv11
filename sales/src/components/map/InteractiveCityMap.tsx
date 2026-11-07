import React, { useEffect, useMemo, useRef, useState } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
import { Agent } from '../../types';
import { TrackingConnectionState } from '../../hooks/useLiveAgentTracking';
import { GlassCard } from '../common/GlassCard';
import { Badge } from '../common/Badge';
import { LeafletAgentMap } from './LeafletAgentMap';
import { ProfileAvatar } from '../common/ProfileAvatar';
import {
  getGoogleMapsAuthError,
  getGoogleMapsConfigError,
  getGoogleMapsConfigIssue,
  GOOGLE_MAPS_AUTH_FAILURE_EVENT,
  loadGoogleMaps,
} from '../../services/googleMaps';
import { getAgentMapStatusMessage } from '../../services/trackingStatus';
import {
  AlertTriangle,
  Battery,
  Clock3,
  Crosshair,
  Gauge,
  LocateFixed,
  MapPin,
  Navigation,
  Radio,
  Route,
} from 'lucide-react';

interface InteractiveCityMapProps {
  agents: Agent[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agent: Agent) => void;
  heightClass?: string;
  connectionState?: TrackingConnectionState;
}

const isValidPosition = (agent: Agent) =>
  Number.isFinite(agent.coordinates.lat) &&
  Number.isFinite(agent.coordinates.lng) &&
  Math.abs(agent.coordinates.lat) <= 90 &&
  Math.abs(agent.coordinates.lng) <= 180;

const statusColor = (agent: Agent) =>
  agent.trackingStatus === 'online'
    ? '#22c55e'
    : agent.trackingStatus === 'gps_delayed'
      ? '#f59e0b'
      : agent.trackingStatus === 'gps_unavailable'
        ? '#f97316'
        : agent.trackingStatus === 'off_shift'
          ? '#64748b'
          : '#ef4444';

const formatLastUpdated = (value?: string) => {
  if (!value) return 'Awaiting live fix';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDelay = (milliseconds?: number) => {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
};

const coordinateDistanceMeters = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const escapeHtml = (value: unknown) => String(value ?? '—').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]!));

const createMarkerContent = (agent: Agent, selected: boolean) => {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = `tf-map-marker ${selected ? 'is-selected' : ''} status-${(agent.trackingStatus ?? 'off_shift')
    .toLowerCase()
    .replace(' ', '-')}`;
  root.setAttribute('aria-label', `Focus ${agent.name}, ${agent.trackingStatusLabel ?? 'Off Shift'}`);

  const heading = Number.isFinite(agent.heading) ? agent.heading : 0;
  const initials = agent.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  root.innerHTML = `
    <span class="tf-marker-heading" style="transform:translateX(-50%) rotate(${heading}deg);color:#2563eb">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1l5 13-5-3-5 3L8 1z"/></svg>
    </span>
    <span class="tf-marker-pulse" style="--status:#3b82f6"></span>
    <span class="tf-marker-avatar-wrap">
      <span class="tf-marker-avatar" aria-hidden="true" style="display:grid;place-items:center;background:#2563eb;color:white;font-size:10px;font-weight:800">${initials}</span>
      <span class="tf-marker-status" style="background:${statusColor(agent)}"></span>
    </span>
    <span class="tf-marker-meta">
      <strong>${agent.name.split(' ')[0]}</strong>
      <small>${Math.round(agent.speedKmH)} km/h · ${Math.round(agent.batteryLevel)}%</small>
    </span>
  `;
  return root;
};

type MapMarker = google.maps.marker.AdvancedMarkerElement;

const detachMarker = (marker: MapMarker) => {
  marker.map = null;
};

const setMarkerPosition = (marker: MapMarker, position: google.maps.LatLngLiteral) => {
  marker.position = position;
};

const setMarkerZIndex = (marker: MapMarker, zIndex: number) => {
  marker.zIndex = zIndex;
};

export const InteractiveCityMap: React.FC<InteractiveCityMapProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  heightClass = 'h-[500px]',
  connectionState = 'offline',
}) => {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();
  const useGoogleMaps = false;
  const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined)?.trim();
  const configIssue = getGoogleMapsConfigIssue(apiKey, mapId);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map>();
  const markersRef = useRef(new Map<string, MapMarker>());
  const markerPositionsRef = useRef(new Map<string, { lat: number; lng: number }>());
  const markerAnimationsRef = useRef(new Map<string, number>());
  const infoWindowRef = useRef<google.maps.InfoWindow>();
  const accuracyCirclesRef = useRef(new Map<string, google.maps.Circle>());
  const routePolylinesRef = useRef<google.maps.Polyline[]>([]);
  const travelledPolylineRef = useRef<google.maps.Polyline>();
  const shopMarkersRef = useRef<MapMarker[]>([]);
  const geofenceCirclesRef = useRef<google.maps.Circle[]>([]);
  const lastRouteRef = useRef<{ origin: google.maps.LatLngLiteral; destinationKey: string; requestedAt: number }>();
  const routeGenerationRef = useRef(0);
  const routeInFlightRef = useRef<string>();
  const routeMetricsRef = useRef<{ eta?: number; distance?: number }>({});
  const didFitRef = useRef(false);
  const onSelectRef = useRef(onSelectAgent);
  const selectedAgentIdRef = useRef(selectedAgentId);
  const agentsRef = useRef(agents);
  const [activeFilter, setActiveFilter] = useState<'All' | 'Active' | 'On Break' | 'Offline'>('All');
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'openstreetmap'>(
    !useGoogleMaps || configIssue ? 'openstreetmap' : 'loading',
  );
  const [mapError, setMapError] = useState(useGoogleMaps && configIssue ? getGoogleMapsConfigError(configIssue) : '');
  const [routeMetrics, setRouteMetrics] = useState<{ eta?: number; distance?: number }>({});

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const filteredAgents = useMemo(
    () => agents.filter((agent) => activeFilter === 'All' || agent.status === activeFilter),
    [activeFilter, agents],
  );

  useEffect(() => {
    onSelectRef.current = onSelectAgent;
    selectedAgentIdRef.current = selectedAgentId;
    agentsRef.current = agents;
  }, [agents, onSelectAgent, selectedAgentId]);

  const disposeGoogleMap = () => {
    routeGenerationRef.current += 1;
    routeInFlightRef.current = undefined;
    markerAnimationsRef.current.forEach((frame) => cancelAnimationFrame(frame));
    markerAnimationsRef.current.clear();
    markersRef.current.forEach(detachMarker);
    markersRef.current.clear();
    markerPositionsRef.current.clear();
    accuracyCirclesRef.current.forEach((circle) => circle.setMap(null));
    accuracyCirclesRef.current.clear();
    routePolylinesRef.current.forEach((polyline) => polyline.setMap(null));
    routePolylinesRef.current = [];
    travelledPolylineRef.current?.setMap(null);
    travelledPolylineRef.current = undefined;
    shopMarkersRef.current.forEach(detachMarker);
    shopMarkersRef.current = [];
    travelledPolylineRef.current?.setMap(null);
    travelledPolylineRef.current = undefined;
    geofenceCirclesRef.current.forEach((circle) => circle.setMap(null));
    geofenceCirclesRef.current = [];
    infoWindowRef.current?.close();
    infoWindowRef.current = undefined;
    mapRef.current = undefined;
    didFitRef.current = false;
  };

  useEffect(() => {
    if (!useGoogleMaps || !apiKey || configIssue || !mapElementRef.current || mapRef.current) return;
    let cancelled = false;

    setMapStatus('loading');
    loadGoogleMaps(apiKey)
      .then(({ maps }) => {
        if (cancelled || !mapElementRef.current) return;
        const firstPosition = agentsRef.current.find(isValidPosition)?.coordinates ?? { lat: 7.8731, lng: 80.7718 };
        mapRef.current = new maps.Map(mapElementRef.current, {
          center: firstPosition,
          zoom: agentsRef.current.some(isValidPosition) ? 12 : 7,
          mapId,
          backgroundColor: '#07111f',
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'cooperative',
          keyboardShortcuts: true,
        });
        infoWindowRef.current = new maps.InfoWindow();
        setMapStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[Reproutes Map] Google Maps JavaScript API failed to load', {
          origin: window.location.origin,
          error,
        });
        setMapStatus('error');
        setMapError(error instanceof Error ? error.message : 'Google Maps could not be loaded.');
      });

    return () => {
      cancelled = true;
      disposeGoogleMap();
    };
  }, [apiKey, configIssue, mapId, useGoogleMaps]);

  useEffect(() => {
    if (!useGoogleMaps) return;
    const handleAuthFailure = () => {
      disposeGoogleMap();
      setMapStatus('error');
      setMapError(getGoogleMapsAuthError());
    };
    window.addEventListener(GOOGLE_MAPS_AUTH_FAILURE_EVENT, handleAuthFailure);
    return () => window.removeEventListener(GOOGLE_MAPS_AUTH_FAILURE_EVENT, handleAuthFailure);
  }, [useGoogleMaps]);

  useEffect(() => {
    if (mapStatus !== 'ready' || !mapRef.current) return;
    let cancelled = false;

    importLibrary('marker').then(({ AdvancedMarkerElement }) => {
      if (cancelled || !mapRef.current) return;
      const visibleIds = new Set(filteredAgents.filter(isValidPosition).map((agent) => agent.id));

      markersRef.current.forEach((marker, id) => {
        if (!visibleIds.has(id)) {
          detachMarker(marker);
          markersRef.current.delete(id);
          markerPositionsRef.current.delete(id);
          const animation = markerAnimationsRef.current.get(id);
          if (animation) cancelAnimationFrame(animation);
          markerAnimationsRef.current.delete(id);
          accuracyCirclesRef.current.get(id)?.setMap(null);
          accuracyCirclesRef.current.delete(id);
        }
      });

      filteredAgents.filter(isValidPosition).forEach((agent) => {
        const selected = agent.id === selectedAgent?.id;
        let marker = markersRef.current.get(agent.id);
        if (!marker) {
          marker = new AdvancedMarkerElement({
            map: mapRef.current,
            position: agent.coordinates,
            title: `${agent.name} — ${agent.status}`,
            content: createMarkerContent(agent, selected),
            zIndex: selected ? 100 : 10,
          });
          marker.addListener('click', () => {
            const latestAgent = agentsRef.current.find((item) => item.id === agent.id);
            if (!latestAgent) return;
            onSelectRef.current?.(latestAgent);
            const metrics = selectedAgentIdRef.current === latestAgent.id ? routeMetricsRef.current : {};
            const destination = latestAgent.destination?.label ?? latestAgent.destinationAddress ?? latestAgent.routeAssigned ?? 'Not assigned';
            infoWindowRef.current?.setContent(`<div style="min-width:230px;font:13px/1.55 system-ui;color:#0f172a"><strong style="font-size:15px">${escapeHtml(latestAgent.name)}</strong><br><b>Speed:</b> ${Math.round(latestAgent.speedKmH || 0)} km/h<br><b>GPS accuracy:</b> ${latestAgent.gpsAccuracyMeters == null ? '—' : `±${Math.round(latestAgent.gpsAccuracyMeters)} m`}<br><b>Last updated:</b> ${escapeHtml(formatLastUpdated(latestAgent.lastLocationAt ?? latestAgent.lastUpdatedAt))}<br><b>Destination:</b> ${escapeHtml(destination)}<br><b>Distance:</b> ${metrics.distance ?? latestAgent.remainingDistanceKm ?? '—'} km<br><b>ETA:</b> ${metrics.eta ?? latestAgent.etaMinutes ?? '—'} min</div>`);
            infoWindowRef.current?.open({ map: mapRef.current, anchor: marker });
          });
          markersRef.current.set(agent.id, marker);
          markerPositionsRef.current.set(agent.id, agent.coordinates);
        } else {
          const previous = markerPositionsRef.current.get(agent.id);
          const existingAnimation = markerAnimationsRef.current.get(agent.id);
          if (existingAnimation) cancelAnimationFrame(existingAnimation);

          if (
            previous &&
            (previous.lat !== agent.coordinates.lat || previous.lng !== agent.coordinates.lng)
          ) {
            const startedAt = performance.now();
            const animate = (now: number) => {
              const progress = Math.min(1, (now - startedAt) / 220);
              const eased = 1 - Math.pow(1 - progress, 3);
              setMarkerPosition(marker!, {
                lat: previous.lat + (agent.coordinates.lat - previous.lat) * eased,
                lng: previous.lng + (agent.coordinates.lng - previous.lng) * eased,
              });
              if (progress < 1) {
                markerAnimationsRef.current.set(agent.id, requestAnimationFrame(animate));
              } else {
                markerPositionsRef.current.set(agent.id, agent.coordinates);
                markerAnimationsRef.current.delete(agent.id);
              }
            };
            markerAnimationsRef.current.set(agent.id, requestAnimationFrame(animate));
          } else {
            setMarkerPosition(marker, agent.coordinates);
            markerPositionsRef.current.set(agent.id, agent.coordinates);
          }
          marker.content = createMarkerContent(agent, selected);
          setMarkerZIndex(marker, selected ? 100 : 10);
        }

        // Do not let a coarse desktop/network fix cover the entire map while
        // still retaining the real accuracy value in agent telemetry.
        const accuracy = Math.min(500, Math.max(0, agent.gpsAccuracyMeters ?? 0));
        const existingCircle = accuracyCirclesRef.current.get(agent.id);
        if (accuracy > 0) {
          if (existingCircle) {
            existingCircle.setCenter(agent.coordinates);
            existingCircle.setRadius(accuracy);
            existingCircle.setVisible(selected);
          } else {
            accuracyCirclesRef.current.set(
              agent.id,
              new google.maps.Circle({
                map: mapRef.current,
                center: agent.coordinates,
                radius: accuracy,
                strokeColor: '#22d3ee',
                strokeOpacity: 0.75,
                strokeWeight: 1,
                fillColor: '#06b6d4',
                fillOpacity: 0.1,
                visible: selected,
                clickable: false,
              }),
            );
          }
        }
      });

      if (!didFitRef.current && filteredAgents.some(isValidPosition)) {
        const bounds = new google.maps.LatLngBounds();
        filteredAgents.filter(isValidPosition).forEach((agent) => bounds.extend(agent.coordinates));
        mapRef.current.fitBounds(bounds, 72);
        didFitRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filteredAgents, mapId, mapStatus, selectedAgent?.id]);

  useEffect(() => {
    if (mapStatus !== 'ready' || !mapRef.current || !selectedAgent || !isValidPosition(selectedAgent)) return;

    mapRef.current.panTo(selectedAgent.coordinates);
    if ((mapRef.current.getZoom() ?? 0) < 15) mapRef.current.setZoom(15);
  }, [mapStatus, selectedAgent?.id]);

  useEffect(() => {
    if (mapStatus !== 'ready' || !mapRef.current || !selectedAgent) return;
    let cancelled = false;
    const map = mapRef.current;

    shopMarkersRef.current.forEach(detachMarker);
    shopMarkersRef.current = [];
    geofenceCirclesRef.current.forEach((circle) => circle.setMap(null));
    geofenceCirclesRef.current = [];
    if (!isValidPosition(selectedAgent)) {
      routePolylinesRef.current.forEach((polyline) => polyline.setMap(null));
      routePolylinesRef.current = [];
      setRouteMetrics({});
      routeMetricsRef.current = {};
      map.setCenter({ lat: 7.8731, lng: 80.7718 });
      map.setZoom(7);
      return;
    }
    map.panTo(selectedAgent.coordinates);
    if ((map.getZoom() ?? 0) < 15) map.setZoom(15);
    const travelledPath = (selectedAgent.travelledPath?.length ? selectedAgent.travelledPath : selectedAgent.routeCoordinates)
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (travelledPath.length > 1) {
      travelledPolylineRef.current = new google.maps.Polyline({
        map,
        path: travelledPath,
        strokeColor: '#7c3aed',
        strokeOpacity: 0.82,
        strokeWeight: 5,
        zIndex: 20,
      });
    }
    void importLibrary('marker').then(({ AdvancedMarkerElement }) => {
      if (cancelled) return;
      travelledPath.filter((point) => point.label).forEach((point, index) => {
        const pin = document.createElement('span');
        pin.className = `tf-shop-marker ${point.visited ? 'is-visited' : ''}`;
        pin.textContent = String(index + 1);
        pin.title = point.label ?? `Route stop ${index + 1}`;
        shopMarkersRef.current.push(new AdvancedMarkerElement({ map, position: point, content: pin, title: pin.title, zIndex: 45 }));
      });
    });
    const destination = selectedAgent.destination;
    if (!destination) {
      routePolylinesRef.current.forEach((polyline) => polyline.setMap(null));
      routePolylinesRef.current = [];
      setRouteMetrics({});
      routeMetricsRef.current = {};
      return;
    }

    importLibrary('marker').then(({ AdvancedMarkerElement }) => {
      if (cancelled) return;
      const pin = document.createElement('span');
      pin.className = 'tf-shop-marker';
      pin.title = destination.label ?? 'Assigned shop';
      pin.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 32" width="30" height="40"><path fill="#ef4444" stroke="#fff" stroke-width="2" d="M12 1C5.9 1 1 5.9 1 12c0 8.2 11 19 11 19s11-10.8 11-19C23 5.9 18.1 1 12 1z"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>';
      shopMarkersRef.current.push(new AdvancedMarkerElement({
        map,
        position: destination,
        content: pin,
        title: pin.title,
        zIndex: 50,
      }));

      const destinationKey = `${destination.lat}:${destination.lng}`;
      const routeRequestKey = `${selectedAgent.id}:${destinationKey}`;
      const previousRoute = lastRouteRef.current;
      const movedMeters = previousRoute
        ? coordinateDistanceMeters(previousRoute.origin, selectedAgent.coordinates)
        : Number.POSITIVE_INFINITY;
      if (previousRoute?.destinationKey === destinationKey && movedMeters < 25 && Date.now() - previousRoute.requestedAt < 15_000) return;
      if (routeInFlightRef.current === routeRequestKey) return;
      routeInFlightRef.current = routeRequestKey;
      const routeGeneration = ++routeGenerationRef.current;
      const routeOrigin = selectedAgent.coordinates;
      void importLibrary('routes').then(({ Route }) => Route.computeRoutes({
        origin: routeOrigin,
        destination,
        travelMode: 'DRIVING',
        routingPreference: 'TRAFFIC_AWARE',
        polylineQuality: 'HIGH_QUALITY',
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
      })).then(({ routes }) => {
        if (routeGeneration !== routeGenerationRef.current || !mapRef.current) return;
        const route = routes?.[0];
        if (!route) throw new Error('Google Routes API returned no road route.');
        routePolylinesRef.current.forEach((polyline) => polyline.setMap(null));
        routePolylinesRef.current = route.createPolylines({
          polylineOptions: { strokeColor: '#2563eb', strokeOpacity: 1, strokeWeight: 7 },
        });
        routePolylinesRef.current.forEach((polyline) => polyline.setMap(map));
        if (route.viewport) map.fitBounds(route.viewport, 72);
        const metrics = {
          distance: route.distanceMeters == null ? undefined : Number((route.distanceMeters / 1000).toFixed(1)),
          eta: route.durationMillis == null ? undefined : Math.max(1, Math.round(route.durationMillis / 60_000)),
        };
        routeMetricsRef.current = metrics;
        setRouteMetrics(metrics);
        lastRouteRef.current = { origin: routeOrigin, destinationKey, requestedAt: Date.now() };
      }).catch((error: unknown) => console.error('[Reproutes Map] Google Routes API road route failed', {
        origin: window.location.origin,
        error,
      }))
        .finally(() => {
          if (routeGeneration === routeGenerationRef.current) routeInFlightRef.current = undefined;
        });
    });

    return () => {
      cancelled = true;
      // A stale Routes API response is ignored through the request generation.
    };
  }, [mapId, mapStatus, selectedAgent]);

  const connectionLabel =
    connectionState === 'live'
      ? 'Live GPS'
      : connectionState === 'demo'
        ? 'Awaiting live GPS'
        : connectionState === 'connecting'
          ? 'Connecting'
          : connectionState === 'reconnecting'
            ? 'Reconnecting'
            : 'GPS offline';
  return (
    <GlassCard className={`relative overflow-hidden flex flex-col ${heightClass}`}>
      <div className="tf-map-toolbar absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-700/80 shadow-xl">
          {(['All', 'Active', 'On Break', 'Offline'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeFilter === filter
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
              aria-pressed={activeFilter === filter}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-2 p-1.5 px-3 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-700/80 shadow-xl text-xs font-semibold text-slate-200">
          <span className="relative flex h-2 w-2">
            {connectionState === 'live' && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                connectionState === 'live'
                  ? 'bg-emerald-400'
                  : connectionState === 'demo'
                    ? 'bg-slate-500'
                    : 'bg-slate-500'
              }`}
            />
          </span>
          <Radio className="w-3.5 h-3.5 text-cyan-400" />
          <span>{connectionLabel}</span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 w-full bg-[#030811] overflow-hidden">
        {mapStatus !== 'error' && mapStatus !== 'openstreetmap' && (
          <div
            ref={mapElementRef}
            className="absolute inset-0"
            aria-label="Live field agent map"
          />
        )}

        {mapStatus === 'loading' && (
          <div className="absolute inset-0 z-10 bg-[#07111f] p-6 pt-20" role="status">
            <div className="h-full rounded-2xl bg-slate-900/70 animate-pulse overflow-hidden relative">
              <div className="absolute inset-0 bg-grid-pattern opacity-40" />
              <div className="absolute top-1/3 left-1/4 h-10 w-28 rounded-full bg-slate-800" />
              <div className="absolute top-1/2 left-2/3 h-10 w-28 rounded-full bg-slate-800" />
            </div>
            <span className="sr-only">Loading Google Maps</span>
          </div>
        )}

        {mapStatus === 'error' && (
          <>
            <div className="absolute inset-0 z-[1]">
              <LeafletAgentMap
                agents={filteredAgents}
                selectedAgentId={selectedAgent?.id}
                onSelectAgent={(agent) => onSelectRef.current?.(agent)}
              />
            </div>
            <div
              className="pointer-events-none absolute bottom-3 left-1/2 z-[600] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-400/30 bg-slate-950/90 px-4 py-2 text-[11px] font-medium text-slate-200 shadow-lg backdrop-blur-md"
              role="status"
              title={mapError}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>Google Maps unavailable — using OpenStreetMap</span>
            </div>
          </>
        )}

        {mapStatus === 'openstreetmap' && (
          <LeafletAgentMap
            agents={filteredAgents}
            selectedAgentId={selectedAgent?.id}
            onSelectAgent={(agent) => onSelectRef.current?.(agent)}
          />
        )}

        {mapStatus === 'ready' &&
          selectedAgent &&
          isValidPosition(selectedAgent) &&
          selectedAgent.destination && (
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 pointer-events-none">
            <span className="map-metric-chip">
              <Navigation className="w-3 h-3 text-cyan-400" />
              ETA {routeMetrics.eta ?? selectedAgent.etaMinutes ?? '—'} min
            </span>
            <span className="map-metric-chip">
              <Route className="w-3 h-3 text-indigo-400" />
              {routeMetrics.distance ?? selectedAgent.remainingDistanceKm ?? '—'} km remaining
            </span>
            <span className="map-metric-chip">
              <Crosshair className="w-3 h-3 text-emerald-400" />
              ±{selectedAgent.gpsAccuracyMeters ?? '—'} m
            </span>
          </div>
        )}
        {mapStatus === 'ready' && selectedAgent && (!isValidPosition(selectedAgent) || !selectedAgent.destination) && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full border border-cyan-500/25 bg-slate-950/80 px-4 py-2 text-center text-[11px] font-medium text-slate-300 shadow-lg backdrop-blur-md">
              {getAgentMapStatusMessage(
                selectedAgent,
                isValidPosition(selectedAgent),
                Boolean(selectedAgent.destination),
              )}
            </div>
          )}
      </div>

      {selectedAgent && (
        <div className="z-20 border-t border-slate-100 bg-white/95 p-4 text-slate-700 backdrop-blur-xl">
          {(selectedAgent.travelledPath?.length || selectedAgent.routeCoordinates.length) > 0 && <div className="mb-3 flex items-center gap-2 overflow-x-auto rounded-xl bg-violet-50/70 px-3 py-2 text-[11px] font-bold text-violet-700" aria-label="Travelled route">
            <Route className="h-3.5 w-3.5 shrink-0"/><span className="shrink-0">Start</span>{(selectedAgent.travelledPath?.length ? selectedAgent.travelledPath : selectedAgent.routeCoordinates).filter((point) => point.label).map((point, index) => <React.Fragment key={`${point.lat}-${point.lng}-${index}`}><span className="text-violet-300">→</span><span className="shrink-0">{point.label}</span></React.Fragment>)}<span className="text-violet-300">→</span><span className="shrink-0">Current location</span>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <ProfileAvatar
              src={selectedAgent.avatar}
              name={selectedAgent.name}
              className="w-12 h-12 rounded-xl object-cover border-2 border-cyan-400/50 shadow-lg shrink-0 text-xs"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold text-slate-900">{selectedAgent.name}</h4>
                <span className="text-xs font-semibold text-indigo-600">({selectedAgent.employeeCode})</span>
                <Badge status={selectedAgent.presenceStatus ?? 'OFFLINE'} />
                <Badge status={selectedAgent.shiftStatus ?? 'OFF_SHIFT'} />
                <Badge status={selectedAgent.gpsStatus ?? 'UNAVAILABLE'} />
              </div>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">
                {selectedAgent.trackingSecondaryStatus ?? 'Off Shift'}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                <span>{selectedAgent.currentLocation}</span>
                <span className="text-slate-600">•</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {isValidPosition(selectedAgent)
                    ? `${selectedAgent.coordinates.lat.toFixed(5)}, ${selectedAgent.coordinates.lng.toFixed(5)}`
                    : 'Waiting for first GPS fix'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div>
              <span className="text-slate-400 flex items-center gap-1 text-[10px] uppercase font-bold">
                <Gauge className="w-3 h-3" /> Speed
              </span>
              <span className="text-sm font-extrabold text-cyan-700">{selectedAgent.speedKmH} km/h</span>
            </div>
            <div>
              <span className="text-slate-400 flex items-center gap-1 text-[10px] uppercase font-bold">
                <Battery className="w-3 h-3" /> Battery
              </span>
              <span className="text-sm font-extrabold text-slate-800">{selectedAgent.batteryLevel}%</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-slate-400 flex items-center gap-1 text-[10px] uppercase font-bold">
                <Clock3 className="w-3 h-3" /> Last update
              </span>
              <span className="text-sm font-bold text-slate-700">
                {formatLastUpdated(selectedAgent.lastUpdatedAt)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 flex items-center gap-1 text-[10px] uppercase font-bold">
                <Crosshair className="w-3 h-3" /> Accuracy
              </span>
              <span className="text-sm font-bold text-slate-700">
                {selectedAgent.gpsAccuracyMeters == null ? '—' : `±${Math.round(selectedAgent.gpsAccuracyMeters)} m`}
              </span>
            </div>
            <div>
              <span className="text-slate-400 flex items-center gap-1 text-[10px] uppercase font-bold">
                <Radio className="w-3 h-3" /> Display delay
              </span>
              <span className="text-sm font-bold text-slate-700">
                {formatDelay(selectedAgent.managerDisplayDelayMs)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!isValidPosition(selectedAgent)) return;
                if (mapRef.current) {
                  mapRef.current.panTo(selectedAgent.coordinates);
                  mapRef.current.setZoom(17);
                } else {
                  onSelectRef.current?.(selectedAgent);
                }
              }}
              className="rounded-lg bg-indigo-50 p-2 text-indigo-600 transition-colors duration-200 hover:bg-indigo-100"
              title="Recenter on agent"
              aria-label={`Recenter map on ${selectedAgent.name}`}
            >
              <LocateFixed className="w-4 h-4" />
            </button>
          </div>
          </div></div>
      )}
    </GlassCard>
  );
};
