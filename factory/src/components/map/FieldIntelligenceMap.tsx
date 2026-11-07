import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AgentActivityReport } from '../../services/agentActivityApi';
import type { FieldAgent, PlannedStop } from '../../services/fieldIntelligenceApi';

const pin=(color:string,label:string)=>L.divIcon({className:'',html:`<span style="display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:${color};color:#fff;border:3px solid #fff;box-shadow:0 4px 15px #0f172a55;font:800 12px system-ui">${label}</span>`,iconSize:[32,32],iconAnchor:[16,16]});
const valid=(lat:unknown,lng:unknown)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&!(Number(lat)===0&&Number(lng)===0);

export const FieldIntelligenceMap=({agent,stops,report,replayPoint,onSelectShop}:{agent?:FieldAgent;stops:PlannedStop[];report?:AgentActivityReport;replayPoint?:AgentActivityReport['route']['points'][number];onSelectShop:(id:string)=>void})=>{
  const el=useRef<HTMLDivElement>(null);const map=useRef<L.Map>();
  useEffect(()=>{if(!el.current)return;const instance=L.map(el.current,{center:[7.8731,80.7718],zoom:7,zoomControl:false});map.current=instance;L.control.zoom({position:'topright'}).addTo(instance);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(instance);return()=>{instance.remove();map.current=undefined}},[]);
  useEffect(()=>{const instance=map.current;if(!instance)return;instance.eachLayer(layer=>{if(!(layer instanceof L.TileLayer))instance.removeLayer(layer)});const bounds:L.LatLngExpression[]=[];
    const planned:(L.LatLngExpression)[]=stops.filter(stop=>valid(stop.shop.latitude,stop.shop.longitude)).map(stop=>[Number(stop.shop.latitude),Number(stop.shop.longitude)]);
    if(planned.length>1)L.polyline(planned,{color:'#94a3b8',weight:4,dashArray:'7 9',opacity:.8}).addTo(instance);
    const actual=(report?.route.points??[]).filter(point=>valid(point.latitude,point.longitude)).map(point=>[point.latitude,point.longitude] as L.LatLngExpression);
    if(actual.length>1)L.polyline(actual,{color:'#7c3aed',weight:5,opacity:.85}).addTo(instance);bounds.push(...actual,...planned);
    stops.forEach(stop=>{if(!valid(stop.shop.latitude,stop.shop.longitude))return;const color=stop.status==='VISITED'?'#10b981':stop.status==='MISSED'?'#ef4444':stop.status==='SKIPPED'?'#64748b':'#f59e0b';const marker=L.marker([Number(stop.shop.latitude),Number(stop.shop.longitude)],{icon:pin(color,String(stop.sequence)),title:stop.shop.name}).addTo(instance);marker.bindTooltip(`<strong>${stop.sequence}. ${stop.shop.name}</strong><br>${stop.status.replaceAll('_',' ')}`).on('click',()=>onSelectShop(stop.shop.id))});
    const current=replayPoint??(agent?.currentLocation&&{latitude:agent.currentLocation.latitude,longitude:agent.currentLocation.longitude,capturedAt:agent.currentLocation.at??''});if(current&&valid(current.latitude,current.longitude)){const marker=L.marker([current.latitude,current.longitude],{icon:pin('#2563eb','●'),zIndexOffset:1000}).addTo(instance);marker.bindPopup(`<strong>${agent?.name??'Agent'}</strong><br>${replayPoint?'Route replay':agent?.status.replaceAll('_',' ')}<br>Last updated: ${current.capturedAt?new Date(current.capturedAt).toLocaleTimeString():'Unknown'}<br>Distance today: ${agent?.distanceKm??0} km`);bounds.push([current.latitude,current.longitude])}
    if(bounds.length)instance.fitBounds(L.latLngBounds(bounds),{padding:[40,40],maxZoom:16});else instance.setView([7.8731,80.7718],7);setTimeout(()=>instance.invalidateSize(),0);
  },[agent,onSelectShop,replayPoint,report,stops]);
  return <div ref={el} className="h-[500px] w-full" aria-label="Live sales agent route map"/>;
};
