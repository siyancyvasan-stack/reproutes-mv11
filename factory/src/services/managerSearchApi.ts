import { apiRequest } from './apiClient';

export interface ManagerSearchResults {
  query: string;
  agents: Array<{ id: string; name: string; employeeCode?: string; avatarUrl?: string }>;
  orders: Array<{
    id: string;
    shopName: string;
    status: string;
    totalAmountLkr: number | string;
    agent: { name: string };
  }>;
  shops: Array<{ id: string; name: string; ownerName: string; city: string }>;
  products: Array<{ id: string; name: string; sku: string; category: string }>;
}

export const searchManagerRecords = (query: string) =>
  apiRequest<ManagerSearchResults>(`/api/v1/search?q=${encodeURIComponent(query)}`);
