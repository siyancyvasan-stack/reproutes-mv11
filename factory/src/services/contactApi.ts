import { apiRequest } from './apiClient';
export { callUrl, whatsappUrl } from './contactLinks';

export type ContactRole = 'AGENT' | 'MANAGER' | 'FACTORY_MANAGER';
export type AssignmentType = 'SALES_MANAGER' | 'SALES_FACTORY_MANAGER' | 'MANAGER_FACTORY_MANAGER';

export interface Contact {
  id: string;
  name: string;
  role: ContactRole;
  avatarUrl?: string;
  phone?: string;
  whatsappNumber?: string;
  availability: 'AVAILABLE' | 'INACTIVE';
  presence?: string;
  assignmentType: AssignmentType;
}

export type ContactAdminUser = Omit<Contact, 'assignmentType'>;
export interface ContactAssignment { id: string; userAId: string; userBId: string; type: AssignmentType }

export const loadContacts = () => apiRequest<{ contacts: Contact[] }>('/api/v1/contacts');
export const loadWhatsappDestination = () => apiRequest<{ whatsappNumber: string | null }>('/api/v1/contacts/whatsapp-destination');
export const loadContactAdmin = () => apiRequest<{ users: ContactAdminUser[]; assignments: ContactAssignment[]; phoneCountryCode: string }>('/api/v1/contacts/admin');
export const updateContactUser = (id: string, phone: string, whatsappNumber: string) => apiRequest(`/api/v1/contacts/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ phone: phone || null, whatsappNumber: whatsappNumber || null }) });
export const createContactAssignment = (data: { userAId: string; userBId: string; type: AssignmentType }) => apiRequest<ContactAssignment>('/api/v1/contacts/admin/assignments', { method: 'POST', body: JSON.stringify(data) });
export const deleteContactAssignment = (id: string) => apiRequest<void>(`/api/v1/contacts/admin/assignments/${id}`, { method: 'DELETE' });
export const updateCountryCode = (phoneCountryCode: string) => apiRequest('/api/v1/contacts/admin/country-code', { method: 'PUT', body: JSON.stringify({ phoneCountryCode }) });
