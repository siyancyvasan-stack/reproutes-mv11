import { apiRequest } from './apiClient';

export type Pagination = { page: number; limit: number; total: number; pages: number };
export type FactoryPage<T> = { items: T[]; pagination: Pagination };

export type FactoryDashboard = {
  kpis: Record<'todayProduction' | 'pendingOrders' | 'inProduction' | 'readyToDispatch' | 'lowStockItems' | 'delayedOrders' | 'activeSalespersons' | 'activeFactoryMembers', number>;
  production: { selectedRange: number; daily: number; weekly: number; monthly: number; target: number; completed: number; rejected: number; damaged: number };
  recentOrders: any[];
  range: { from: string; to: string };
  lastUpdatedAt: string;
};

export const factoryApi = {
  dashboard: (query = '') => apiRequest<FactoryDashboard>(`/api/v1/factory/dashboard${query ? `?${query}` : ''}`),
  orders: (query = '') => apiRequest<FactoryPage<any>>(`/api/v1/factory/orders?${query}`),
  retailers: (query = '') => apiRequest<FactoryPage<any>>(`/api/v1/shops?${query}`),
  retailer: (id: string) => apiRequest<any>(`/api/v1/shops/${id}`),
  deleteRetailer: (id: string) => apiRequest<void>('/api/v1/shops/' + id, { method: 'DELETE' }),
  updateOrder: (id: string, status: string) => apiRequest(`/api/v1/factory/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  products: (query = '') => apiRequest<FactoryPage<any>>(`/api/v1/factory/products?${query}`),
  createProduct: (input: Record<string, unknown>) => apiRequest('/api/v1/factory/products', { method: 'POST', body: JSON.stringify(input) }),
  updateProduct: (id: string, input: Record<string, unknown>) => apiRequest(`/api/v1/factory/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProduct: (id: string) => apiRequest<void>('/api/v1/factory/products/' + id, { method: 'DELETE' }),
  uploadProductImage: (id: string, file: File) => { const body = new FormData(); body.append('image', file); return apiRequest(`/api/v1/products/${id}/image`, { method: 'POST', body }); },
  deleteProductImage: (id: string) => apiRequest(`/api/v1/products/${id}/image`, { method: 'DELETE' }),
  inventory: () => apiRequest<any>('/api/v1/factory/inventory'),
  adjustInventory: (input: Record<string, unknown>) => apiRequest('/api/v1/factory/inventory/adjust', { method: 'POST', body: JSON.stringify(input) }),
  createRawMaterial: (input: Record<string, unknown>) => apiRequest('/api/v1/factory/raw-materials', { method: 'POST', body: JSON.stringify(input) }),
  production: (query = '') => apiRequest<FactoryPage<any>>(`/api/v1/factory/production?${query}`),
  createProduction: (input: Record<string, unknown>) => apiRequest('/api/v1/factory/production', { method: 'POST', body: JSON.stringify(input) }),
  updateProduction: (id: string, input: Record<string, unknown>) => apiRequest(`/api/v1/factory/production/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  members: (query = '') => apiRequest<FactoryPage<any>>(`/api/v1/factory/members?${query}`),
  createMember: (input: Record<string, unknown>) => apiRequest('/api/v1/factory/members', { method: 'POST', body: JSON.stringify(input) }),
  updateMember: (id: string, input: Record<string, unknown>) => apiRequest(`/api/v1/factory/members/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteMember: (id: string) => apiRequest<void>('/api/v1/factory/members/' + id, { method: 'DELETE' }),
  attendance: (id: string, action: string) => apiRequest(`/api/v1/factory/members/${id}/attendance`, { method: 'POST', body: JSON.stringify({ action }) }),
  dispatches: (query = '') => apiRequest<FactoryPage<any>>(`/api/v1/factory/dispatches?${query}`),
  createDispatch: (input: Record<string, unknown>) => apiRequest('/api/v1/factory/dispatches', { method: 'POST', body: JSON.stringify(input) }),
  updateDispatch: (id: string, status: string) => apiRequest(`/api/v1/factory/dispatches/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  reports: () => apiRequest<any>('/api/v1/factory/reports'),
  notifications: () => apiRequest<any[]>('/api/v1/notifications?limit=100'),
  markRead: (id: string) => apiRequest<void>(`/api/v1/notifications/${id}/read`, { method: 'PATCH', body: JSON.stringify({}) }),
};
