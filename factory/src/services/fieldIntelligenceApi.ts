import { apiRequest } from './apiClient';
import type { AgentActivityReport } from './agentActivityApi';

export type FieldAgent = { id:string; name:string; avatarUrl?:string; employeeCode?:string; region?:string; status:'ONLINE'|'OFFLINE'|'ON_VISIT'|'TRAVELLING'; startTime?:string; assignedShops:number; completedVisits:number; remainingVisits:number; routeCompletionPercent:number; salesLkr:number; distanceKm:number; lastGpsAt?:string; currentLocation?:{latitude:number;longitude:number;at?:string}|null };
export type PlannedStop = { id:string; sequence:number; status:'PENDING'|'VISITED'|'MISSED'|'SKIPPED'; plannedArrivalTime?:string; shop:{id:string;name:string;address:string;city:string;latitude?:number|null;longitude?:number|null;outstandingBalanceLkr:number;allowedVisitRadiusMeters?:number|null} };
export type Intelligence = {
  date:string; team:FieldAgent[]; teamKpis:{activeAgents:number;assignedShops:number;completedVisits:number;salesLkr:number;distanceKm:number};
  selected:null|{report:AgentActivityReport;plan:null|{id:string;status:string;territory?:string;startLabel?:string;startLatitude?:number;startLongitude?:number;plannedDistanceKm:number;stops:PlannedStop[]};comparison:{completionPercent:number;plannedDistanceKm:number;actualDistanceKm:number;deviationKm:number;missedShops:PlannedStop[];unplannedVisits:AgentActivityReport['visits'];remainingShops:PlannedStop[]};performance:{productiveVisits:number;noSaleVisits:number;productiveVisitMinutes:number;gpsVerifiedVisits:number;averageVisitMinutes:number};alerts:Array<{id:string;type:string;severity:string;message:string}>};
};

export const loadFieldIntelligence = (filters: Record<string,string|undefined>) => {
  const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string,string] => Boolean(entry[1])));
  return apiRequest<Intelligence>(`/api/v1/field-intelligence?${query}`);
};
export const loadRouteReplay = (agentId:string,date:string) => apiRequest<{points:AgentActivityReport['route']['points'];events:AgentActivityReport['timeline']}>(`/api/v1/field-intelligence/agents/${agentId}/replay?date=${date}`);
