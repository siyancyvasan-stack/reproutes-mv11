import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Agent } from '../../types';
import { apiRequest } from '../../services/apiClient';
import { getAgentMapStatusMessage } from '../../services/trackingStatus';

interface LeafletAgentMapProps {
  agents: Agent[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agent: Agent) => void;
}

const hasPosition = (agent: Agent) =>
  Number.isFinite(agent.coordinates.lat) &&
  Number.isFinite(agent.coordinates.lng) &&
  Math.abs(agent.coordinates.lat) <= 90 &&
  Math.abs(agent.coordinates.lng) <= 180 &&
  !(agent.coordinates.lat === 0 && agent.coordinates.lng === 0);

const statusColor = (agent: Agent, selected: boolean) =>
  selected ? '#2563eb'
    : agent.trackingStatus === 'online'
      ? '#22c55e'
    : agent.trackingStatus === 'gps_delayed'
      ? '#f59e0b'
      : agent.trackingStatus === 'gps_unavailable'
        ? '#f97316'
        : agent.trackingStatus === 'off_shift'
          ? '#64748b'
          : '#ef4444';

const SRI_LANKA_CENTER: L.LatLngExpression = [7.8731, 80.7718];

const isValidPoint = (point: { lat: number; lng: number }) =>
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lng) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lng) <= 180 &&
  !(point.lat === 0 && point.lng === 0);

const formatLastUpdate = (value?: string) => {
  if (!value) return 'No GPS update';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const createAgentPopup = (
  agent: Agent,
  route?: { distanceKm: number; etaMinutes: number },
) => {
  const destination = agent.destination;
  const rows = [
    ['Selected agent', agent.name],
    ['Agent ID', agent.employeeCode || agent.id],
    ['Presence', agent.presenceStatus ?? 'OFFLINE'],
    ['Shift', agent.shiftStatus ?? 'OFF_SHIFT'],
    ['GPS', agent.gpsStatus ?? 'UNAVAILABLE'],
    ['Current speed', `${agent.speedKmH ?? 0} km/h`],
    ['Shift distance travelled', `${Number.isFinite(Number(agent.distanceKm)) ? Number(agent.distanceKm).toFixed(2) : '0.00'} km`],
    ['Working distance', `${Number.isFinite(Number(agent.workDistanceKm)) ? Number(agent.workDistanceKm).toFixed(2) : '0.00'} km`],
    ['Break distance', `${Number.isFinite(Number(agent.breakDistanceKm)) ? Number(agent.breakDistanceKm).toFixed(2) : '0.00'} km`],
    ['Heading', agent.heading == null ? '—' : `${Math.round(agent.heading)}°`],
    ['Destination', destination?.label || (destination ? agent.routeAssigned : 'No destination assigned')],
    ['Distance remaining', route ? `${route.distanceKm} km` : agent.remainingDistanceKm == null ? '—' : `${agent.remainingDistanceKm} km`],
    ['ETA', route ? `${route.etaMinutes} min` : agent.etaMinutes == null ? '—' : `${agent.etaMinutes} min`],
    ['Battery', `${agent.batteryLevel ?? 0}%`],
    ['Last GPS update', formatLastUpdate(agent.lastUpdatedAt)],
    ['Accuracy', agent.gpsAccuracyMeters == null ? '—' : `±${Math.round(agent.gpsAccuracyMeters)} m`],
    ['Display delay', Number.isFinite(agent.managerDisplayDelayMs) ? `${(Number(agent.managerDisplayDelayMs) / 1000).toFixed(1)} s` : '—'],
    ['Coordinates', isValidPoint(agent.coordinates) ? `${Number(agent.coordinates.lat).toFixed(6)}, ${Number(agent.coordinates.lng).toFixed(6)}` : '—'],
  ];
  const popup = document.createElement('div');
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(value));
    popup.appendChild(row);
  });
  return popup;
};

export const LeafletAgentMap = ({ agents, selectedAgentId, onSelectAgent }: LeafletAgentMapProps) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>();
  const markersRef = useRef(new Map<string, L.Marker>());
  const markerPositionsRef = useRef(new Map<string, L.LatLngLiteral>());
  const markerAnimationsRef = useRef(new Map<string, number>());
  const plannedRouteRef = useRef<L.Polyline>();
  const travelledRouteRef = useRef<L.Polyline>();
  const visitedStopMarkersRef = useRef<L.Marker[]>([]);
  const destinationMarkerRef = useRef<L.Marker>();
  const routeRequestRef = useRef<AbortController>();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, {
      center: SRI_LANKA_CENTER,
      zoom: 7,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      // Leaflet's zoom transition and our marker interpolation both schedule
      // animation frames. Stop them before removing panes from the DOM.
      map.stop();
      markerAnimationsRef.current.forEach((frame) => cancelAnimationFrame(frame));
      markerAnimationsRef.current.clear();
      routeRequestRef.current?.abort();
      map.remove();
      mapRef.current = undefined;
      markersRef.current.clear();
      markerPositionsRef.current.clear();
      plannedRouteRef.current = undefined;
      travelledRouteRef.current = undefined;
      visitedStopMarkersRef.current = [];
      destinationMarkerRef.current = undefined;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const positionedAgents = agents.filter(hasPosition);
    const visibleIds = new Set(positionedAgents.map((agent) => agent.id));

    markersRef.current.forEach((marker, id) => {
      if (!visibleIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
        markerPositionsRef.current.delete(id);
        const animation = markerAnimationsRef.current.get(id);
        if (animation) cancelAnimationFrame(animation);
        markerAnimationsRef.current.delete(id);
      }
    });

    positionedAgents.forEach((agent) => {
      const selected = agent.id === selectedAgentId;
      const color = statusColor(agent, selected);
      const icon = L.divIcon({
        className: '',
        html: `<button class="tf-leaflet-agent ${selected ? 'is-selected' : ''}" style="--agent-color:${color}" aria-label="${agent.name}">
          <span class="tf-leaflet-pulse"></span>
          <strong>${agent.name.slice(0, 1).toUpperCase()}</strong>
          <small>${agent.name}</small>
        </button>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      let marker = markersRef.current.get(agent.id);
      if (!marker) {
        marker = L.marker([agent.coordinates.lat, agent.coordinates.lng], { icon })
          .addTo(map)
          .on('click', () => onSelectAgent?.(agent));
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
            const progress = Math.min(1, (now - startedAt) / 450);
            const eased = 1 - Math.pow(1 - progress, 3);
            marker!.setLatLng([
              previous.lat + (agent.coordinates.lat - previous.lat) * eased,
              previous.lng + (agent.coordinates.lng - previous.lng) * eased,
            ]);
            if (progress < 1) {
              markerAnimationsRef.current.set(agent.id, requestAnimationFrame(animate));
            } else {
              markerPositionsRef.current.set(agent.id, agent.coordinates);
              markerAnimationsRef.current.delete(agent.id);
            }
          };
          markerAnimationsRef.current.set(agent.id, requestAnimationFrame(animate));
        } else {
          marker.setLatLng([agent.coordinates.lat, agent.coordinates.lng]);
          markerPositionsRef.current.set(agent.id, agent.coordinates);
        }
        marker.setIcon(icon);
        marker.off('click').on('click', () => onSelectAgent?.(agent));
      }
      if (selected) {
        marker.bindPopup(createAgentPopup(agent), { maxWidth: 320 });
      } else {
        marker.closePopup();
        marker.unbindPopup();
      }
      marker.bindTooltip(
        `${agent.name} · ${agent.trackingStatusLabel ?? 'Off Shift'} · ${agent.speedKmH} km/h`,
        { direction: 'top', offset: [0, -18] },
      );
    });

    if (!fittedRef.current && positionedAgents.length) {
      map.stop();
      map.fitBounds(
        L.latLngBounds(positionedAgents.map((agent) => [agent.coordinates.lat, agent.coordinates.lng])),
        { padding: [50, 50], maxZoom: 15 },
      );
      fittedRef.current = true;
    }
  }, [agents, onSelectAgent, selectedAgentId]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = agents.find((agent) => agent.id === selectedAgentId);
    map?.stop();
    map?.closePopup();

    plannedRouteRef.current?.remove();
    plannedRouteRef.current = undefined;
    travelledRouteRef.current?.remove();
    travelledRouteRef.current = undefined;
    visitedStopMarkersRef.current.forEach((marker) => marker.remove());
    visitedStopMarkersRef.current = [];
    destinationMarkerRef.current?.remove();
    destinationMarkerRef.current = undefined;
    routeRequestRef.current?.abort();
    routeRequestRef.current = undefined;

    if (!map || !selected || !hasPosition(selected)) {
      map?.setView(SRI_LANKA_CENTER, 7);
      return;
    }

    console.info('[Reproutes Map] selected marker coordinates', {
      agentId: selected.id,
      coordinates: selected.coordinates,
    });
    const selectedPosition = L.latLng(selected.coordinates.lat, selected.coordinates.lng);
    if (!map.getCenter().equals(selectedPosition, 8) || map.getZoom() < 15) {
      map.setView(selectedPosition, Math.max(map.getZoom(), 15), { animate: false });
    }
    markersRef.current.get(selected.id)?.openPopup();

    const travelledPath = (selected.travelledPath?.length ? selected.travelledPath : selected.routeCoordinates).filter(isValidPoint);
    if (travelledPath.length > 1) {
      travelledRouteRef.current = L.polyline(
        travelledPath.map((point) => [point.lat, point.lng]),
        { color: '#7c3aed', opacity: .82, weight: 5 },
      ).addTo(map);
    }
    travelledPath.filter((point) => point.label).forEach((point, index) => {
      const icon = L.divIcon({
        className: '',
        html: `<span class="tf-shop-marker ${point.visited ? 'is-visited' : ''}"><b style="transform:rotate(45deg)">${index + 1}</b></span>`,
        iconSize: [24, 24], iconAnchor: [12, 12],
      });
      visitedStopMarkersRef.current.push(L.marker([point.lat, point.lng], { icon, title: point.label }).addTo(map).bindPopup(point.label ?? `Route stop ${index + 1}`));
    });

    const destination = selected.destination;
    if (!destination || !isValidPoint(destination)) return;

    const destinationIcon = L.divIcon({
          className: '',
          html: '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 5px rgba(239,68,68,.25)"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
      });
    destinationMarkerRef.current = L.marker([destination.lat, destination.lng], {
          icon: destinationIcon,
          title: destination.label || selected.routeAssigned || 'Assigned sales shop',
        })
          .addTo(map)
          .bindPopup(destination.label || selected.routeAssigned || 'Assigned sales shop');
    const boundsPoints: L.LatLngExpression[] = [
      [selected.coordinates.lat, selected.coordinates.lng],
      [destination.lat, destination.lng],
    ];
    map.stop();
    map.fitBounds(L.latLngBounds(boundsPoints), { padding: [50, 50], maxZoom: 16, animate: false });

    const controller = new AbortController();
    routeRequestRef.current = controller;
    const routeQuery = new URLSearchParams({
          originLat: String(selected.coordinates.lat),
          originLng: String(selected.coordinates.lng),
          destinationLat: String(destination.lat),
          destinationLng: String(destination.lng),
        });
    void apiRequest<{
          path: Array<{ lat: number; lng: number }>;
          distanceKm: number;
          etaMinutes: number;
        }>(`/api/v1/tracking/route?${routeQuery}`, { signal: controller.signal })
      .then((route) => {
            if (controller.signal.aborted || route.path.length < 2) return;
            plannedRouteRef.current?.remove();
            plannedRouteRef.current = L.polyline(
              route.path.map((point) => [point.lat, point.lng]),
              { color: '#2563eb', opacity: 1, weight: 8 },
            )
              .addTo(map)
              .bindTooltip(`${route.distanceKm} km · ${route.etaMinutes} min`, {
                permanent: true,
                direction: 'center',
                className: 'tf-route-metric-tooltip',
              });
            map.stop();
            map.fitBounds(plannedRouteRef.current.getBounds(), { padding: [50, 50], maxZoom: 16, animate: false });
            const selectedMarker = markersRef.current.get(selected.id);
            selectedMarker?.bindPopup(createAgentPopup(selected, route), { maxWidth: 320 });
            selectedMarker?.openPopup();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('[Reproutes Map] road route unavailable', error);
        }
      });
    return () => routeRequestRef.current?.abort();
  }, [agents, selectedAgentId]);

  const hasAnyPosition = agents.some(hasPosition);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedHasPosition = Boolean(selectedAgent && hasPosition(selectedAgent));
  const selectedHasDestination = Boolean(selectedAgent?.destination && isValidPoint(selectedAgent.destination));
  const statusMessage = selectedAgent
    ? getAgentMapStatusMessage(selectedAgent, selectedHasPosition, selectedHasDestination)
    : !hasAnyPosition
      ? 'No live GPS positions yet'
      : null;
  return (
    <div className="absolute inset-0">
      <div ref={elementRef} className="h-full w-full" aria-label="Live agent map" />
      {statusMessage && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[500] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full border border-cyan-500/25 bg-slate-950/80 px-4 py-2 text-center text-[11px] font-medium text-slate-300 shadow-lg backdrop-blur-md">
          {statusMessage}
        </div>
      )}
    </div>
  );
};
