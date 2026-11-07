import { apiRequest } from './apiClient';

export type ChatContact = { id: string; name: string; role: string; avatarUrl?: string; employeeCode?: string };
export type ChatMessage = {
  id: string; senderId: string; recipientId?: string; broadcast: boolean; type: string; content: string;
  attachmentName?: string; attachmentMime?: string; urgent: boolean; createdAt: string;
  reads: Array<{ userId: string; readAt: string }>; sender?: { id: string; name?: string; role: string };
};
export type AiActionProposal = {
  id: string;
  requestedBy: string;
  summary: string;
  status: 'PENDING' | 'CONFIRMED';
  createdAt: string;
  requester?: { id: string; name: string; employeeCode?: string };
};
export type AiMessage = {
  id: string;
  senderId: string;
  broadcast: false;
  type: 'AI';
  content: string;
  urgent: false;
  createdAt: string;
  updatedAt: string;
  reads: [];
};
export type SafetyEvent = {
  id: string; agentId: string;
  type: 'OFFLINE' | 'STATIONARY' | 'GPS_DISABLED' | 'LOCATION_PERMISSION_DENIED' | 'LOW_BATTERY' | 'INTERNET_DISCONNECTED' | 'BACKGROUND_TRACKING_STOPPED' | 'SOS' | 'INCIDENT' | 'CHECK_IN';
  severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO'; status: 'OPEN' | 'RESOLVED' | 'ARCHIVED' | 'DELETED';
  latitude?: number; longitude?: number; accuracy?: number; battery?: number; description?: string; photoKeys: string[];
  alertStartedAt: string; lastGpsAt?: string; resolvedAt?: string; resolutionNote?: string; archivedAt?: string; createdAt: string; updatedAt: string;
  agent?: { name: string; phone?: string; employeeCode?: string; status?: string; trackingState?: string };
};
export type SafetyFilter = 'ALL' | 'CRITICAL' | 'OFFLINE' | 'STATIONARY' | 'SOS' | 'RESOLVED' | 'ARCHIVED';
export type EmergencyContact = { id: string; name: string; phone: string; relationship?: string; priority: number };
export type SafetyEventDetails = {
  event: SafetyEvent;
  agent?: { id: string; name: string; phone?: string; employeeCode?: string; profile?: { status?: string; latitude?: number; longitude?: number; lastLocationAt?: string; locationPermission?: string; trackingState?: string; batteryLevel?: number; lastSpeedKmH?: number } };
  attendance?: { status: string; checkInAt: string; checkOutAt?: string };
  lastVisit?: { visitedAt: string; departedAt?: string; latitude: number; longitude: number; shop: { id: string; name: string; address?: string } };
  history: SafetyEvent[];
  audit: Array<{ id: string; action: string; createdAt: string; metadata?: { reason?: string }; actor?: { name: string } }>;
};

export const loadChatContacts = () => apiRequest<ChatContact[]>('/api/v1/chat/contacts');
export const loadChatMessages = (peerId = '') => apiRequest<ChatMessage[]>(`/api/v1/chat/messages?peerId=${encodeURIComponent(peerId)}`);
export const sendChatMessage = (input: { recipientId?: string; broadcast?: boolean; content: string; urgent?: boolean; type?: string; file?: Blob; fileName?: string }) => {
  const form = new FormData();
  if (input.recipientId) form.append('recipientId', input.recipientId);
  form.append('broadcast', String(Boolean(input.broadcast)));
  form.append('content', input.content);
  form.append('urgent', String(Boolean(input.urgent)));
  form.append('type', input.type ?? 'TEXT');
  if (input.file) form.append('file', input.file, input.fileName ?? 'attachment');
  return apiRequest<ChatMessage>('/api/v1/chat/messages', { method: 'POST', body: form });
};
export const markChatRead = (id: string) => apiRequest<void>(`/api/v1/chat/messages/${id}/read`, { method: 'POST', body: JSON.stringify({}) });
export const loadAiMessages = () => apiRequest<AiMessage[]>('/api/v1/chat/ai/messages');
export const askOperationsAi = (prompt: string) => apiRequest<{ answer: string; context: Record<string, number>; proposal?: { id: string; summary: string }; messages: AiMessage[] }>('/api/v1/chat/ai/messages', { method: 'POST', body: JSON.stringify({ prompt }) });
export const updateAiMessage = (id: string, content: string) => apiRequest<AiMessage>(`/api/v1/chat/ai/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ content }) });
export const loadPendingAiProposals = () => apiRequest<AiActionProposal[]>('/api/v1/chat/ai/proposals');
export const confirmAiProposal = (id: string) => apiRequest(`/api/v1/chat/ai/proposals/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) });

export const loadSafetyEvents = (filter: SafetyFilter = 'ALL', search = '') => apiRequest<{ items: SafetyEvent[]; total: number }>(`/api/v1/safety/events?filter=${filter}&search=${encodeURIComponent(search)}&limit=100`);
export const loadSafetyEventDetails = (id: string) => apiRequest<SafetyEventDetails>(`/api/v1/safety/events/${id}/details`);
export const loadEmergencyContacts = () => apiRequest<EmergencyContact[]>('/api/v1/safety/contacts');
export const createEmergencyContact = (input: { name: string; phone: string; relationship?: string; priority?: number }) => apiRequest<EmergencyContact>('/api/v1/safety/contacts', { method: 'POST', body: JSON.stringify(input) });
export const updateEmergencyContact = (id: string, input: { name: string; phone: string; relationship?: string; priority?: number }) => apiRequest<EmergencyContact>(`/api/v1/safety/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteEmergencyContact = (id: string, permanent = false) => apiRequest<void>(`/api/v1/safety/contacts/${id}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' });
export const createSafetyEvent = (type: 'sos' | 'check-in', input: Record<string, unknown>) => apiRequest<SafetyEvent>(`/api/v1/safety/${type}`, { method: 'POST', body: JSON.stringify(input) });
export const createIncident = (form: FormData) => apiRequest<SafetyEvent>('/api/v1/safety/incidents', { method: 'POST', body: form });
export const resolveSafetyEvent = (id: string, note: string) => apiRequest<void>(`/api/v1/safety/events/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ note }) });
export const archiveSafetyEvent = (id: string, reason: string) => apiRequest<void>(`/api/v1/safety/events/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ reason }) });
export const deleteSafetyEvent = (id: string, reason: string, permanent = false) => apiRequest<void>(`/api/v1/safety/events/${id}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
export const bulkResolveSafetyEvents = (ids: string[], note: string) => apiRequest<{ updated: number }>('/api/v1/safety/events/bulk/resolve', { method: 'PATCH', body: JSON.stringify({ ids, note }) });
export const bulkArchiveSafetyEvents = (ids: string[], reason: string) => apiRequest<{ updated: number }>('/api/v1/safety/events/bulk/archive', { method: 'PATCH', body: JSON.stringify({ ids, reason }) });
