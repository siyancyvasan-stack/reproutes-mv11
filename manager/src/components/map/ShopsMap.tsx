import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const pin = (color: string, label: string) =>
  L.divIcon({
    className: '',
    html: `<span style="display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:${color};color:#fff;border:3px solid #fff;box-shadow:0 4px 15px #0f172a55;font:800 12px system-ui">${label}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

const valid = (lat: unknown, lng: unknown) =>
  Number.isFinite(Number(lat)) &&
  Number.isFinite(Number(lng)) &&
  !(Number(lat) === 0 && Number(lng) === 0);

export interface ShopMapData {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  status?: string;
}

export const ShopsMap = ({
  shops,
  onSelectShop,
}: {
  shops: ShopMapData[];
  onSelectShop?: (id: string) => void;
}) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();

  useEffect(() => {
    if (!el.current) return;
    const instance = L.map(el.current, {
      center: [7.8731, 80.7718],
      zoom: 7,
      zoomControl: false,
    });
    map.current = instance;
    L.control.zoom({ position: 'topright' }).addTo(instance);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(instance);
    return () => {
      instance.remove();
      map.current = undefined;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    // Remove all markers
    instance.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) instance.removeLayer(layer);
    });

    const bounds: L.LatLngExpression[] = [];
    const validShops = shops.filter((shop) =>
      valid(shop.latitude, shop.longitude)
    );

    validShops.forEach((shop, index) => {
      const lat = Number(shop.latitude);
      const lng = Number(shop.longitude);
      const position: L.LatLngExpression = [lat, lng];
      bounds.push(position);

      // Color based on status
      const color =
        shop.status === 'APPROVED'
          ? '#10b981'
          : shop.status === 'SUBMITTED'
            ? '#3b82f6'
            : shop.status === 'UNDER_REVIEW'
              ? '#8b5cf6'
              : shop.status === 'DRAFT'
                ? '#64748b'
                : '#f59e0b';

      const marker = L.marker(position, {
        icon: pin(color, '●'),
        title: shop.name,
      }).addTo(instance);

      marker.bindPopup(
        `<div style="min-width: 200px;">
          <strong style="font-size: 14px; color: #1e293b;">${shop.name}</strong><br>
          <span style="font-size: 12px; color: #64748b;">Owner: ${shop.ownerName}</span><br>
          <span style="font-size: 12px; color: #64748b;">City: ${shop.city}</span><br>
          <span style="font-size: 12px; color: #64748b;">Phone: ${shop.phone}</span><br>
          <span style="font-size: 11px; color: #94a3b8;">Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}</span>
        </div>`
      );

      if (onSelectShop) {
        marker.on('click', () => onSelectShop(shop.id));
      }
    });

    if (bounds.length) {
      instance.fitBounds(L.latLngBounds(bounds), {
        padding: [40, 40],
        maxZoom: 16,
      });
    } else {
      instance.setView([7.8731, 80.7718], 7);
    }

    setTimeout(() => instance.invalidateSize(), 0);
  }, [shops, onSelectShop]);

  return (
    <div
      ref={el}
      className="h-[600px] w-full rounded-2xl overflow-hidden shadow-lg"
      aria-label="Registered shops map"
    />
  );
};
