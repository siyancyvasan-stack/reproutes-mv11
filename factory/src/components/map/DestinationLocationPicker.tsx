import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface DestinationLocationPickerProps {
  latitude?: number;
  longitude?: number;
  onChange: (latitude: number, longitude: number) => void;
}

const SRI_LANKA_CENTER: L.LatLngExpression = [7.8731, 80.7718];

export const DestinationLocationPicker = ({
  latitude,
  longitude,
  onChange,
}: DestinationLocationPickerProps) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>();
  const markerRef = useRef<L.Marker>();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const valid = Number.isFinite(latitude) && Number.isFinite(longitude);
    const map = L.map(elementRef.current, {
      center: valid ? [latitude!, longitude!] : SRI_LANKA_CENTER,
      zoom: valid ? 16 : 7,
      zoomControl: true,
      // Let the destination form keep scrolling when the pointer is over the
      // embedded map. Users can still zoom with the visible +/- controls.
      scrollWheelZoom: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const select = ({ latlng }: L.LeafletMouseEvent) =>
      onChangeRef.current(Number(latlng.lat.toFixed(7)), Number(latlng.lng.toFixed(7)));
    map.on('click', select);
    map.on('contextmenu', select);
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.off('click', select);
      map.off('contextmenu', select);
      map.remove();
      mapRef.current = undefined;
      markerRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const point: L.LatLngExpression = [latitude!, longitude!];
    if (markerRef.current) markerRef.current.setLatLng(point);
    else markerRef.current = L.marker(point).addTo(map).bindPopup('Assigned destination');
    map.setView(point, Math.max(map.getZoom(), 16));
  }, [latitude, longitude]);

  return (
    <div>
      <div ref={elementRef} className="h-56 w-full touch-pan-y overflow-hidden rounded-xl border border-slate-300 sm:h-60" />
      <p className="mt-1.5 text-[10px] text-slate-500">
        Click or long-press the map to select the shop location.
      </p>
    </div>
  );
};
