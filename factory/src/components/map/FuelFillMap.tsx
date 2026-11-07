import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Loader2, MapPinned } from 'lucide-react';
import { importLibrary } from '@googlemaps/js-api-loader';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Agent } from '../../types';
import type { FuelEntry } from '../../services/fuelApi';
import { apiRequest } from '../../services/apiClient';
import {
  getGoogleMapsAuthError,
  getGoogleMapsConfigError,
  getGoogleMapsConfigIssue,
  GOOGLE_MAPS_AUTH_FAILURE_EVENT,
  loadGoogleMaps,
} from '../../services/googleMaps';

const SRI_LANKA = { lat: 7.8731, lng: 80.7718 };

const validPoint = (lat?: number, lng?: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180;

const age = (value?: string) => {
  if (!value) return 'Awaiting live GPS';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return date.toLocaleString();
};

const html = (value: unknown) => String(value ?? '—').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]!));

const distanceMeters = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

type RouteState = { origin: google.maps.LatLngLiteral; destinationKey: string };

const createFuelMarkerContent = () => {
  const marker = document.createElement('span');
  marker.style.cssText = 'display:block;width:16px;height:16px;border:2px solid #fff;border-radius:50%;background:#06b6d4;box-shadow:0 2px 6px #0f172a66';
  return marker;
};

const createAgentMarkerContent = (heading?: number) => {
  const marker = document.createElement('span');
  marker.style.cssText = `display:block;width:22px;height:22px;transform:rotate(${Number.isFinite(heading) ? heading : 0}deg);filter:drop-shadow(0 2px 3px #0f172a66)`;
  marker.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 21l-8-4-8 4 8-19Z" fill="#4f46e5" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
  return marker;
};

export const FuelFillMap = ({ entries, agents = [] }: { entries: FuelEntry[]; agents?: Agent[] }) => {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();
  const useGoogleMaps = false;
  const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined)?.trim();
  const configIssue = getGoogleMapsConfigIssue(apiKey, mapId);
  const elementRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map>();
  const leafletLayerRef = useRef<L.LayerGroup>();
  const currentLocationMarkerRef = useRef<L.CircleMarker>();
  const mapRef = useRef<google.maps.Map>();
  const infoRef = useRef<google.maps.InfoWindow>();
  const liveMarkersRef = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const stationMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const renderersRef = useRef(new Map<string, google.maps.DirectionsRenderer>());
  const routeStateRef = useRef(new Map<string, RouteState>());
  const routeGenerationRef = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'openstreetmap' | 'error'>(
    useGoogleMaps ? (configIssue ? 'error' : 'loading') : 'openstreetmap',
  );
  const [error, setError] = useState(
    useGoogleMaps && configIssue ? getGoogleMapsConfigError(configIssue) : '',
  );
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');

  const locateUser = () => {
    if (!navigator.geolocation) {
      setLocationMessage('GPS is not supported by this browser.');
      return;
    }
    setLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const point = { lat: coords.latitude, lng: coords.longitude };
      if (useGoogleMaps && mapRef.current) {
        mapRef.current.panTo(point);
        mapRef.current.setZoom(16);
      } else if (leafletMapRef.current) {
        currentLocationMarkerRef.current?.remove();
        currentLocationMarkerRef.current = L.circleMarker([point.lat, point.lng], {
          radius: 9, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1,
        }).bindPopup(`Your current location<br>Accuracy ±${Math.round(coords.accuracy)} m`).addTo(leafletMapRef.current);
        leafletMapRef.current.setView([point.lat, point.lng], 16);
        currentLocationMarkerRef.current.openPopup();
      }
      setLocationMessage(`Located · accuracy ±${Math.round(coords.accuracy)} m`);
      setLocating(false);
    }, (reason) => {
      setLocationMessage(reason.code === reason.PERMISSION_DENIED
        ? 'Allow location permission in the browser and try again.'
        : 'Current location could not be detected. Please try again.');
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };

  const latestClaimByAgent = useMemo(() => {
    const result = new Map<string, FuelEntry>();
    [...entries]
      .filter((entry) => entry.salesperson?.id && validPoint(entry.latitude, entry.longitude))
      .sort((a, b) => new Date(b.purchasedAt ?? b.createdAt).getTime() - new Date(a.purchasedAt ?? a.createdAt).getTime())
      .forEach((entry) => { if (!result.has(entry.salesperson!.id)) result.set(entry.salesperson!.id, entry); });
    return result;
  }, [entries]);

  useEffect(() => {
    if (!useGoogleMaps || !apiKey || configIssue || !elementRef.current) return;
    let cancelled = false;
    loadGoogleMaps(apiKey).then(({ maps }) => {
      if (cancelled || !elementRef.current) return;
      mapRef.current = new maps.Map(elementRef.current, {
        center: SRI_LANKA,
        zoom: 7,
        mapId,
        disableDefaultUI: true,
        zoomControl: true,
        fullscreenControl: true,
        streetViewControl: false,
        gestureHandling: 'cooperative',
      });
      infoRef.current = new maps.InfoWindow();
      setStatus('ready');
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'Google Maps could not be loaded.');
      }
    });
    return () => { cancelled = true; };
  }, [apiKey, configIssue, mapId, useGoogleMaps]);

  useEffect(() => {
    if (useGoogleMaps || !elementRef.current) return;
    const map = L.map(elementRef.current, { center: [SRI_LANKA.lat, SRI_LANKA.lng], zoom: 7 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    leafletMapRef.current = map;
    leafletLayerRef.current = L.layerGroup().addTo(map);
    return () => {
      currentLocationMarkerRef.current?.remove();
      currentLocationMarkerRef.current = undefined;
      map.remove();
      leafletMapRef.current = undefined;
      leafletLayerRef.current = undefined;
    };
  }, [useGoogleMaps]);

  useEffect(() => {
    if (useGoogleMaps || !leafletMapRef.current || !leafletLayerRef.current) return;
    const layer = leafletLayerRef.current;
    const controller = new AbortController();
    layer.clearLayers();
    const points: L.LatLngExpression[] = [];
    entries.filter((entry) => validPoint(entry.latitude, entry.longitude)).forEach((entry) => {
      const point: L.LatLngExpression = [entry.latitude!, entry.longitude!];
      points.push(point);
      L.circleMarker(point, {
        radius: 7, color: '#ffffff', weight: 2, fillColor: '#06b6d4', fillOpacity: 1,
      }).bindPopup(`<strong>${html(entry.fuelStation)}</strong><br>${html(entry.salesperson?.name)} · ${html(entry.vehicle.vehicleNumber)}`).addTo(layer);
    });
    agents.filter((agent) => validPoint(agent.coordinates.lat, agent.coordinates.lng)).forEach((agent) => {
      const point: L.LatLngExpression = [agent.coordinates.lat, agent.coordinates.lng];
      points.push(point);
      L.circleMarker(point, {
        radius: 8, color: '#ffffff', weight: 2, fillColor: '#4f46e5', fillOpacity: 1,
      }).bindPopup(`<strong>${html(agent.name)}</strong><br>${html(agent.vehicleNo)}<br>${html(age(agent.lastLocationAt ?? agent.lastUpdatedAt))}`).addTo(layer);

      const claim = latestClaimByAgent.get(agent.id);
      if (!claim) return;
      const destination = validPoint(claim.stationLatitude, claim.stationLongitude)
        ? { lat: claim.stationLatitude!, lng: claim.stationLongitude! }
        : { lat: claim.latitude!, lng: claim.longitude! };
      const routeQuery = new URLSearchParams({
        originLat: String(agent.coordinates.lat),
        originLng: String(agent.coordinates.lng),
        destinationLat: String(destination.lat),
        destinationLng: String(destination.lng),
      });
      void apiRequest<{ path: Array<{ lat: number; lng: number }> }>(
        `/api/v1/tracking/route?${routeQuery}`,
        { signal: controller.signal },
      ).then((route) => {
        if (controller.signal.aborted || route.path.length < 2) return;
        const colors = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777'];
        L.polyline(route.path.map((routePoint) => [routePoint.lat, routePoint.lng]), {
          color: colors[agents.findIndex((item) => item.id === agent.id) % colors.length],
          opacity: .85,
          weight: 5,
        }).addTo(layer);
      }).catch(() => undefined);
    });
    if (points.length) leafletMapRef.current.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
    return () => controller.abort();
  }, [agents, entries, latestClaimByAgent, useGoogleMaps]);

  useEffect(() => {
    const handleAuthFailure = () => {
      setStatus('error');
      setError(getGoogleMapsAuthError());
    };
    if (!useGoogleMaps) return;
    window.addEventListener(GOOGLE_MAPS_AUTH_FAILURE_EVENT, handleAuthFailure);
    return () => window.removeEventListener(GOOGLE_MAPS_AUTH_FAILURE_EVENT, handleAuthFailure);
  }, [useGoogleMaps]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    let cancelled = false;
    stationMarkersRef.current.forEach((marker) => { marker.map = null; });
    void importLibrary('marker').then(({ AdvancedMarkerElement }) => {
      if (cancelled || !mapRef.current) return;
      stationMarkersRef.current = entries.filter((entry) => validPoint(entry.latitude, entry.longitude)).map((entry) => {
        const marker = new AdvancedMarkerElement({
          map: mapRef.current,
          position: { lat: entry.latitude!, lng: entry.longitude! },
          title: entry.fuelStation,
          content: createFuelMarkerContent(),
          zIndex: 5,
        });
        marker.addListener('click', () => {
          infoRef.current?.setContent(`<div style="min-width:190px;font:13px system-ui"><strong>${html(entry.fuelStation)}</strong><br>${html(entry.salesperson?.name)} · ${html(entry.vehicle.vehicleNumber)}<br>Purchased ${html(new Date(entry.purchasedAt ?? entry.createdAt).toLocaleString())}<br>GPS accuracy ${entry.gpsAccuracy == null ? '—' : `±${Math.round(entry.gpsAccuracy)} m`}</div>`);
          infoRef.current?.open({ map: mapRef.current, anchor: marker });
        });
        return marker;
      });
    });
    return () => {
      cancelled = true;
      stationMarkersRef.current.forEach((marker) => { marker.map = null; });
      stationMarkersRef.current = [];
    };
  }, [entries, status]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    let cancelled = false;
    const visible = new Set(agents.filter((agent) => validPoint(agent.coordinates.lat, agent.coordinates.lng)).map((agent) => agent.id));
    liveMarkersRef.current.forEach((marker, id) => { if (!visible.has(id)) { marker.map = null; liveMarkersRef.current.delete(id); } });

    void importLibrary('marker').then(({ AdvancedMarkerElement }) => agents.filter((agent) => validPoint(agent.coordinates.lat, agent.coordinates.lng)).forEach((agent) => {
      if (cancelled || !mapRef.current) return;
      const position = { lat: agent.coordinates.lat, lng: agent.coordinates.lng };
      let marker = liveMarkersRef.current.get(agent.id);
      if (!marker) {
        marker = new AdvancedMarkerElement({ map: mapRef.current, position, title: agent.name, zIndex: 20, content: createAgentMarkerContent(agent.heading) });
        liveMarkersRef.current.set(agent.id, marker);
      } else {
        marker.position = position;
        marker.content = createAgentMarkerContent(agent.heading);
      }
      google.maps.event.clearListeners(marker, 'click');
      marker.addListener('click', () => {
        const claim = latestClaimByAgent.get(agent.id);
        infoRef.current?.setContent(`<div style="min-width:220px;font:13px/1.55 system-ui"><strong style="font-size:14px">${html(agent.name)}</strong><br><b>Vehicle:</b> ${html(claim?.vehicle.vehicleNumber ?? agent.vehicleNo)}<br><b>Speed:</b> ${Math.round(agent.speedKmH || 0)} km/h<br><b>Last updated:</b> ${html(age(agent.lastLocationAt ?? agent.lastUpdatedAt))}<br><b>Fuel station:</b> ${html(claim?.fuelStation ?? 'No recorded purchase')}<br><b>GPS accuracy:</b> ${agent.gpsAccuracyMeters == null ? '—' : `±${Math.round(agent.gpsAccuracyMeters)} m`}</div>`);
        infoRef.current?.open({ map: mapRef.current, anchor: marker });
      });
    }));
    return () => { cancelled = true; };
  }, [agents, latestClaimByAgent, status]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const generation = ++routeGenerationRef.current;
    void importLibrary('routes').then(() => {
      if (generation !== routeGenerationRef.current || !mapRef.current) return;
      const active = new Set<string>();
      agents.forEach((agent, index) => {
        const claim = latestClaimByAgent.get(agent.id);
        if (!claim || !validPoint(agent.coordinates.lat, agent.coordinates.lng)) return;
        active.add(agent.id);
        const origin = { lat: agent.coordinates.lat, lng: agent.coordinates.lng };
        const hasStationPoint = validPoint(claim.stationLatitude, claim.stationLongitude);
        const destination = hasStationPoint
          ? { lat: claim.stationLatitude!, lng: claim.stationLongitude! }
          : { lat: claim.latitude!, lng: claim.longitude! };
        const previous = routeStateRef.current.get(agent.id);
        const destinationKey = `${claim.id}:${destination.lat}:${destination.lng}`;
        if (previous?.destinationKey === destinationKey && distanceMeters(previous.origin, origin) < 25) return;
        const service = new google.maps.DirectionsService();
        void service.route({ origin, destination, travelMode: google.maps.TravelMode.DRIVING }).then((result) => {
          if (generation !== routeGenerationRef.current || !mapRef.current) return;
          let renderer = renderersRef.current.get(agent.id);
          if (!renderer) {
            const colors = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777'];
            renderer = new google.maps.DirectionsRenderer({ map: mapRef.current, suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: colors[index % colors.length], strokeOpacity: .85, strokeWeight: 5 } });
            renderersRef.current.set(agent.id, renderer);
          }
          renderer.setDirections(result);
          routeStateRef.current.set(agent.id, { origin, destinationKey });
        }).catch(() => undefined);
      });
      renderersRef.current.forEach((renderer, id) => { if (!active.has(id)) { renderer.setMap(null); renderersRef.current.delete(id); routeStateRef.current.delete(id); } });
    });
  }, [agents, latestClaimByAgent, status]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const points = [
      ...agents.filter((agent) => validPoint(agent.coordinates.lat, agent.coordinates.lng)).map((agent) => agent.coordinates),
      ...entries.filter((entry) => validPoint(entry.latitude, entry.longitude)).map((entry) => ({ lat: entry.latitude!, lng: entry.longitude! })),
    ];
    if (points.length) { const bounds = new google.maps.LatLngBounds(); points.forEach((point) => bounds.extend(point)); mapRef.current.fitBounds(bounds, 48); }
  }, [status]);

  return <div className="relative h-80 w-full overflow-hidden rounded-2xl" aria-label="Live fuel purchase tracking map">
    <div ref={elementRef} className="h-full w-full" />
    <div className="absolute right-3 top-3 z-[1000] flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2">
      <button type="button" onClick={locateUser} disabled={locating} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
        {locating ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} className="text-blue-600" />}
        {locating ? 'Locating…' : 'Locate me'}
      </button>
      {locationMessage && <p className="rounded-lg bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow ring-1 ring-slate-200">{locationMessage}</p>}
    </div>
    {status === 'loading' && <div className="absolute inset-0 grid place-items-center bg-slate-100 text-sm font-bold text-slate-500">Loading Google Maps…</div>}
    {status === 'error' && <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-50 to-cyan-50 p-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-cyan-100 text-cyan-700"><MapPinned size={24}/></span>
        <p className="mt-3 font-bold text-slate-800">Map is temporarily unavailable</p>
        <p className="mt-1 text-sm text-slate-500">Fuel locations will appear here when the map connection is restored.</p>
        {import.meta.env.DEV && <details className="mt-3 text-left text-xs text-slate-400"><summary className="cursor-pointer text-center">Technical details</summary><p className="mt-2 rounded-lg bg-white/80 p-2">{error}</p></details>}
      </div>
    </div>}
  </div>;
};
