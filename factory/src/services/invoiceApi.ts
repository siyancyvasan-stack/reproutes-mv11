import { apiBlob, apiRequest } from './apiClient';
export const invoiceApi = {
  list: (query = '') => apiRequest<any>(`/api/v1/invoices?${query}`),
  payment: (id: string, input: Record<string, unknown>) => apiRequest(`/api/v1/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify(input) }),
  pdf: (id: string) => apiBlob(`/api/v1/invoices/${id}/pdf`),
};
