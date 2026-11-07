import { Agent, AttendanceRecord, KpiSummary, Order, Product, Shop } from '../types';
import { apiRequest, isBackendConfigured } from './apiClient';
import { enqueueFieldOperation } from './fieldOperationQueue';

type Page<T> = { items: T[]; pagination: { page: number; limit: number; total: number } };

export type AttendanceReport = {
  generatedAt: string;
  range: { from: string; to: string; days: number };
  today: {
    date: string;
    totalAgents: number;
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    attendancePercentage: number;
  };
  daily: Array<{
    date: string;
    day: string;
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    attendancePercentage: number;
  }>;
  leaderboard: Array<{
    agentId: string;
    name: string;
    employeeCode?: string;
    avatarUrl?: string;
    presentDays: number;
    lateDays: number;
    leaveDays: number;
    totalDistanceKm: number;
    attendancePercentage: number;
  }>;
  records: Array<{
    id: string;
    agentId: string;
    date: string;
    checkInAt: string;
    checkOutAt?: string;
    distanceKm: number;
    workDistanceKm: number;
    breakDistanceKm: number;
    averageSpeedKmH: number;
    maximumSpeedKmH: number;
    gpsCoverage: number;
    gpsDelayCount: number;
    longestGpsGapSeconds: number;
    shiftDurationMinutes: number;
    workingDurationMinutes: number;
    breakDurationMinutes: number;
    expectedPoints: number;
    receivedPoints: number;
    lastKnownLocation?: { latitude: number; longitude: number };
    routeHistory: Array<{ latitude: number; longitude: number; capturedAt: string; receivedAt: string }>;
    status: string;
    agent: { id: string; name: string; employeeCode?: string; avatarUrl?: string };
  }>;
};

const toAgent = (item: any, fallback: Agent[] = []): Agent => {
  const existing = fallback.find((agent) => agent.employeeCode === item.employeeCode);
  return {
    id: item.id,
    name: item.name,
    email: item.email,
    employeeCode: item.employeeCode ?? '',
    avatar: item.avatarUrl ?? existing?.avatar ?? '',
    phone: item.phone ?? existing?.phone ?? '',
    status:
      item.agentProfile?.status === 'ON_BREAK'
        ? 'On Break'
        : item.agentProfile?.status === 'ACTIVE'
          ? 'Active'
          : 'Offline',
    loginTime: item.agentProfile?.lastSeenAt
      ? new Date(item.agentProfile.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Not connected',
    currentLocation: 'Awaiting live GPS',
    coordinates: {
      lat: Number(item.agentProfile?.latitude ?? Number.NaN),
      lng: Number(item.agentProfile?.longitude ?? Number.NaN),
    },
    distanceKm: 0,
    workDistanceKm: 0,
    breakDistanceKm: 0,
    gpsCoverage: 0,
    ordersCount: 0,
    casesSold: 0,
    breakDurationMinutes: 0,
    routeAssigned: item.agentProfile?.routeAssigned ?? existing?.routeAssigned ?? '',
    vehicleNo: item.agentProfile?.vehicleNo ?? existing?.vehicleNo ?? '',
    batteryLevel: item.agentProfile?.batteryLevel ?? existing?.batteryLevel ?? 0,
    speedKmH: 0,
    trackingStatus: item.agentProfile?.shiftActive ? 'offline' : 'off_shift',
    shiftActive: item.agentProfile?.shiftActive ?? false,
    socketConnected: item.agentProfile?.socketConnected ?? false,
    lastHeartbeatAt: item.agentProfile?.lastHeartbeatAt ?? undefined,
    lastPresenceAt: item.agentProfile?.lastHeartbeatAt ?? item.agentProfile?.lastSeenAt ?? undefined,
    lastLocationAt: item.agentProfile?.lastLocationAt ?? undefined,
    locationPermission: item.agentProfile?.locationPermission ?? 'unknown',
    todayRevenueLkr: 0,
    visitedShopsCount: 0,
    totalShopsAssigned: 0,
    routeCoordinates: [],
    destinationAddress: item.agentProfile?.destinationAddress ?? undefined,
    ...(Number.isFinite(item.agentProfile?.destinationLat) &&
    Number.isFinite(item.agentProfile?.destinationLng)
      ? {
          destination: {
            lat: item.agentProfile.destinationLat,
            lng: item.agentProfile.destinationLng,
            label: item.agentProfile.destinationName ?? 'Assigned sales shop',
          },
        }
      : {}),
  };
};

export const loadAgents = async (fallback: Agent[] = []) => {
  if (!isBackendConfigured) return fallback;
  const response = await apiRequest<Page<any>>('/api/v1/agents?limit=100');
  return response.items.map((item) => toAgent(item, fallback));
};

export const createAgent = async (input: {
  name: string;
  email: string;
  password: string;
  employeeCode: string;
  phone?: string;
  routeAssigned?: string;
  vehicleNo?: string;
}) => toAgent(await apiRequest<any>('/api/v1/agents', {
  method: 'POST',
  body: JSON.stringify(input),
}));

export const deleteAgent = (agentId: string) =>
  apiRequest<void>(`/api/v1/agents/${agentId}`, { method: 'DELETE' });

export const updateAgent = (agentId: string, input: Omit<Parameters<typeof createAgent>[0], 'password'> & { password?: string }) =>
  apiRequest<any>(`/api/v1/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(input) });

export const uploadAgentAvatar = async (agentId: string, file: File) => {
  const form = new FormData();
  form.append('avatar', file);
  return apiRequest<{ avatarUrl: string }>(`/api/v1/agents/${agentId}/avatar`, {
    method: 'POST',
    body: form,
  });
};

export const removeAgentAvatar = (agentId: string) =>
  apiRequest<void>(`/api/v1/agents/${agentId}/avatar`, { method: 'DELETE' });

export const assignAgentDestination = (
  agentId: string,
  destination: { name: string; address: string; latitude: number; longitude: number },
) => apiRequest(`/api/v1/agents/${agentId}/destination`, {
  method: 'PATCH',
  body: JSON.stringify(destination),
});

export const loadProducts = async (fallback: Product[] = []) => {
  if (!isBackendConfigured) return fallback;
  const response = await apiRequest<Page<any>>('/api/v1/products?limit=100');
  return response.items.map((item) => ({
    id: item.id, name: item.name, sku: item.sku, category: item.category,
    pricePerCaseLkr: Number(item.pricePerCaseLkr), unitsPerCase: item.unitsPerCase,
    unitPriceLkr: Number(item.pricePerCaseLkr) / Math.max(item.unitsPerCase, 1),
    stockCases: item.stockCases,
    image: item.imageUrl ?? fallback.find((product) => product.sku === item.sku)?.image ?? '',
    active: item.active,
  }));
};

const toProduct = (item: any): Product => ({
  id: item.id,
  name: item.name,
  sku: item.sku,
  category: item.category,
  pricePerCaseLkr: Number(item.pricePerCaseLkr),
  unitsPerCase: item.unitsPerCase,
  unitPriceLkr: Number(item.pricePerCaseLkr) / Math.max(item.unitsPerCase, 1),
  stockCases: item.stockCases,
  image: item.imageUrl ?? '',
  active: item.active,
});

export const createProduct = async (input: {
  name: string;
  sku: string;
  category: string;
  pricePerCaseLkr: number;
  unitsPerCase: number;
  stockCases: number;
  imageUrl?: string;
}) => toProduct(await apiRequest<any>('/api/v1/products', {
  method: 'POST',
  body: JSON.stringify(input),
}));

export const updateProduct = async (id: string, input: Parameters<typeof createProduct>[0]) => toProduct(await apiRequest<any>(`/api/v1/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));

const toShop = (item: any): Shop => ({
  id: item.id,
  retailerCode: item.retailerCode ?? item.shopCode ?? undefined,
  name: item.name,
  ownerName: item.ownerName,
  phone: item.phone,
  alternateMobile: item.alternateMobile ?? undefined,
  email: item.email ?? undefined,
  address: item.address,
  city: item.city,
  coordinates: { lat: item.latitude ?? Number.NaN, lng: item.longitude ?? Number.NaN },
  routeGroup: item.routeGroup ?? '',
  territory: item.territory ?? item.routeGroup ?? '',
  status: item.status,
  assignedAgentName: item.assignedSalesperson?.name,
  lastVisitAt: item.lastVisitAt,
  visitedToday: Boolean(item.lastVisitAt && new Date(item.lastVisitAt).toDateString() === new Date().toDateString()),
  outstandingBalanceLkr: Number(item.outstandingBalanceLkr),
  paymentTerms: item.paymentTerms ?? undefined,
  images: item.images ?? [],
  primaryImageUrl: item.images?.find((image: any) => image.isPrimary)?.url ?? item.images?.[0]?.url,
});

export const loadShops = async (fallback: Shop[] = []) => {
  if (!isBackendConfigured) return fallback;
  const response = await apiRequest<Page<any>>('/api/v1/shops?limit=100');
  return response.items.map(toShop);
};

export const createShop = async (input: {
  name: string;
  ownerName: string;
  phone: string;
  address: string;
  city: string;
  routeGroup?: string;
  outstandingBalanceLkr?: number;
  paymentMethod?: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT';
  paymentTerms?: string;
  creditLimitLkr?: number;
}) => toShop(await apiRequest<any>('/api/v1/shops', {
  method: 'POST',
  body: JSON.stringify(input),
}));

export const uploadProductImage = async (productId: string, file: File) => {
  const body = new FormData(); body.append('image', file);
  return toProduct(await apiRequest<any>(`/api/v1/products/${productId}/image`, { method: 'POST', body }));
};

export const deleteProductImage = (productId: string) => apiRequest<void>(`/api/v1/products/${productId}/image`, { method: 'DELETE' });

export const uploadShopImage = async (shopId: string, file: File, type: 'FRONT'|'INTERIOR'|'DISPLAY_RACK', isPrimary = false) => {
  const body = new FormData(); body.append('image', file); body.append('type', type); body.append('isPrimary', String(isPrimary));
  return apiRequest<any>(`/api/v1/shops/${shopId}/images`, { method: 'POST', body });
};

export const loadOrders = async (fallback: Order[] = []) => {
  if (!isBackendConfigured) return fallback;
  const response = await apiRequest<Page<any>>('/api/v1/orders?limit=100');
  return response.items.map((item) => ({
    id: item.id, agentId: item.agentId, agentName: item.agent?.name ?? '',
    shopId: item.shopId ?? item.id, shopName: item.shopName, shopAddress: item.shopAddress,
    casesCount: item.items.reduce((sum: number, row: any) => sum + row.cases, 0),
    totalAmountLkr: Number(item.totalAmountLkr),
    time: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: new Date(item.createdAt).toISOString().slice(0, 10),
    status: item.status.charAt(0) + item.status.slice(1).toLowerCase(),
    paymentTerm: item.paymentTerm, remarks: item.remarks,
    items: item.items.map((row: any) => ({
      id: row.id, productId: row.productId, productName: row.product?.name ?? '',
      sku: row.product?.sku ?? '', pricePerCaseLkr: Number(row.unitPrice),
      casesQuantity: row.cases, totalLkr: Number(row.totalAmount),
    })),
  })) as Order[];
};

export const createOrder = async (input: {
  shopId?: string;
  shopVisitId?: string;
  shopName: string;
  shopAddress: string;
  paymentTerm: string;
  remarks?: string;
  items: Array<{ productId: string; cases: number }>;
},agentId?:string) => {
  if(navigator.onLine)return apiRequest<any>('/api/v1/orders', { method: 'POST', body: JSON.stringify(input) });
  if(!agentId)throw new Error('Network unavailable.');
  const dependency=input.shopVisitId?.startsWith('pending:')?input.shopVisitId.slice(8):undefined;
  return enqueueFieldOperation({agentId,kind:'ORDER',url:'/api/v1/orders',method:'POST',body:input,dependsOn:dependency});
};

export const updateOrderStatus = (id: string, status: Order['status']) =>
  apiRequest(`/api/v1/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: status.toUpperCase() }),
  });

export const deleteOrder = (id: string) =>
  apiRequest<void>(`/api/v1/orders/${id}`, { method: 'DELETE' });

export const loadAttendance = async (fallback: AttendanceRecord[] = []) => {
  if (!isBackendConfigured) return fallback;
  const rows = await apiRequest<any[]>('/api/v1/attendance');
  return rows.map((item) => ({
    id: item.id, agentId: item.agentId, agentName: item.agent?.name ?? item.agent_name ?? '',
    date: String(item.date).slice(0, 10),
    checkInTime: item.checkInAt ? new Date(item.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A',
    checkOutTime: item.checkOutAt ? new Date(item.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
    checkInLocation: (item.checkInLat != null && item.checkInLng != null && !isNaN(Number(item.checkInLat))) ? `${Number(item.checkInLat).toFixed(5)}, ${Number(item.checkInLng).toFixed(5)}` : 'Location unavailable',
    checkOutLocation: (item.checkOutLat != null && item.checkOutLng != null && !isNaN(Number(item.checkOutLat))) ? `${Number(item.checkOutLat).toFixed(5)}, ${Number(item.checkOutLng).toFixed(5)}` : undefined,
    checkInOdometerKm: 0, totalDistanceKm: Number(item.distanceKm || 0),
    workingHours: item.checkOutAt ? `${((new Date(item.checkOutAt).getTime() - new Date(item.checkInAt).getTime()) / 3_600_000).toFixed(1)} hrs` : 'In progress',
    status: item.status === 'HALF_DAY' ? 'Half Day' : item.status ? item.status.charAt(0) + item.status.slice(1).toLowerCase() : 'Present',
  })) as AttendanceRecord[];
};

export const deleteAttendance = (id: string) =>
  apiRequest<void>(`/api/v1/attendance/${id}`, { method: 'DELETE' });

export const loadAttendanceReport = () =>
  apiRequest<AttendanceReport>('/api/v1/attendance/report?days=7');

export const loadDashboardKpis = async (fallback: KpiSummary, query = '') => {
  if (!isBackendConfigured) return fallback;
  const response = await apiRequest<any>(`/api/v1/analytics/dashboard${query ? `?${query}` : ''}`);
  return {
    ...fallback,
    totalAgents: response.kpis.agents,
    activeAgents: response.kpis.activeAgents,
    agentsOnBreak: response.kpis.agentsOnBreak,
    offlineAgents: response.kpis.offlineAgents,
    todayOrdersCount: response.kpis.orders,
    todaySalesLkr: Number(response.kpis.revenueLkr),
  };
};
