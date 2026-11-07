import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AgentActivityReport } from '../../services/agentActivityApi';

type Props = { route: AgentActivityReport['route']; visits: AgentActivityReport['visits']; routePlan?:AgentActivityReport['routePlan'];replayPoint?:AgentActivityReport['route']['points'][number]; onSelectVisit?: (id: string) => void; className?: string };
const valid = (point?: { latitude?: number|null; longitude?: number|null } | null) => Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && !(point.latitude === 0 && point.longitude === 0));
const dot = (color: string, label: string) => L.divIcon({ className: '', html: `<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:9999px;background:${color};color:white;border:3px solid white;box-shadow:0 4px 14px rgba(15,23,42,.45);font:bold 12px system-ui">${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });

export const DailyRouteMap = ({ route, visits,routePlan,replayPoint, onSelectVisit,className='h-[60dvh] min-h-[420px] sm:min-h-[560px]' }: Props) => {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { center: [7.8731, 80.7718], zoom: 7 }); map.current = instance;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(instance);
    return () => { instance.remove(); map.current = undefined; };
  }, []);
  useEffect(() => { window.setTimeout(() => map.current?.invalidateSize(), 0); }, [className]);
  useEffect(() => {
    const instance = map.current; if (!instance) return;
    instance.eachLayer((layer) => { if (!(layer instanceof L.TileLayer)) instance.removeLayer(layer); });
    const bounds: L.LatLngExpression[] = [];
    const path = route.points.filter(valid).map((point) => [point.latitude, point.longitude] as L.LatLngExpression);
    if (path.length > 1) { L.polyline(path, { color: '#06b6d4', weight: 5, opacity: .85 }).addTo(instance); bounds.push(...path); }
    const planned=[...(routePlan?.startLatitude!=null&&routePlan.startLongitude!=null?[[routePlan.startLatitude,routePlan.startLongitude] as L.LatLngExpression]:[]),...(routePlan?.stops??[]).filter(stop=>valid(stop.shop)).map(stop=>[stop.shop.latitude!,stop.shop.longitude!] as L.LatLngExpression)];
    if(planned.length>1){L.polyline(planned,{color:'#a78bfa',weight:3,opacity:.65,dashArray:'6 9'}).addTo(instance);bounds.push(...planned)}
    if (valid(route.start)) { const start = route.start!; L.marker([start.latitude, start.longitude], { icon: dot('#8b5cf6', 'S'), title: 'Start location' }).addTo(instance).bindPopup(`<strong>Start location</strong><br>${new Date(start.at).toLocaleTimeString()}`); bounds.push([start.latitude, start.longitude]); }
    visits.filter(valid).forEach((visit) => {
      const marker = L.marker([visit.latitude, visit.longitude], { icon: dot('#10b981', String(visit.sequence)), title: visit.shopName }).addTo(instance);
      const popup = document.createElement('div');
      if (visit.shopImageUrl) {
        const image = document.createElement('img');
        image.src = visit.shopImageUrl;
        image.alt = `${visit.shopName} shop`;
        image.loading = 'lazy';
        image.style.cssText = 'display:block;width:100%;height:110px;object-fit:cover;border-radius:8px;margin-bottom:8px';
        popup.append(image);
      }
      const title = document.createElement('strong'); title.textContent = `${visit.sequence}. ${visit.shopName}`; popup.append(title);
      const orderIds = visit.orders.map((order) => order.id).join(', ') || 'None';
      const invoiceIds = visit.invoices.map((invoice) => invoice.invoiceNumber).join(', ') || 'None';
      [`Arrival: ${new Date(visit.arrivalAt).toLocaleTimeString()}`, `Departure: ${visit.departureAt ? new Date(visit.departureAt).toLocaleTimeString() : 'In progress'}`, `Stay: ${visit.durationMinutes} min`, `GPS: ${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}`, `Order IDs: ${orderIds}`, `Invoice IDs: ${invoiceIds}`, `Sales: LKR ${visit.salesLkr.toLocaleString()}`, `Collected: LKR ${visit.collectedLkr.toLocaleString()}`, `Payment: ${visit.paymentStatus}`, `Notes: ${visit.notes || 'None'}`].forEach((text) => { const row = document.createElement('div'); row.textContent = text; popup.append(row); });
      marker.bindPopup(popup).on('click', () => onSelectVisit?.(visit.id)); bounds.push([visit.latitude, visit.longitude]);
    });
    const visitedShopIds=new Set(visits.map(visit=>visit.shopId));
    routePlan?.stops.filter(stop=>!visitedShopIds.has(stop.shop.id)&&valid(stop.shop)).forEach(stop=>{const missed=stop.status==='MISSED';L.marker([stop.shop.latitude!,stop.shop.longitude!],{icon:dot(missed?'#ef4444':'#f59e0b',String(stop.sequence)),title:stop.shop.name}).addTo(instance).bindPopup(`<strong>${stop.shop.name}</strong><br>${missed?'Missed':'Pending'}`);bounds.push([stop.shop.latitude!,stop.shop.longitude!])});
    const current=replayPoint??route.end;
    if (valid(current)) { const end = current!; L.marker([end.latitude, end.longitude], { icon: dot('#3b82f6', replayPoint?'●':'C'), title: replayPoint?'Replay position':'Current/final location' }).addTo(instance).bindPopup(`<strong>${replayPoint?'Replay position':'Current/final location'}</strong><br>${new Date('capturedAt' in end?end.capturedAt:end.at).toLocaleTimeString()}`); bounds.push([end.latitude, end.longitude]); }
    if (bounds.length) instance.fitBounds(L.latLngBounds(bounds), { padding: [35, 35], maxZoom: 16 }); else instance.setView([7.8731, 80.7718], 7);
    window.setTimeout(() => instance.invalidateSize(), 0);
  }, [onSelectVisit, replayPoint, route, routePlan, visits]);
  const empty=!route.points.length&&!valid(route.start)&&!valid(route.end);
  return <div className="relative"><div ref={element} className={`${className} w-full overflow-hidden rounded-xl`} aria-label="Daily travelled route and numbered shop visits" />{empty&&<div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-slate-950/65 p-6 text-center text-sm font-bold text-slate-300">No GPS history recorded for this date</div>}</div>;
};
