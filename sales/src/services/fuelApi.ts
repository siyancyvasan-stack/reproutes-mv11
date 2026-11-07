import { apiBlob, apiRequest } from './apiClient';

export type FuelStatus = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'FLAGGED';

export interface Vehicle {
  id: string; vehicleNumber: string; vehicleType: string; fuelType: 'PETROL' | 'DIESEL' | 'OTHER';
  tankCapacity: number; expectedKmL: number; minimumKmL: number; maximumKmL: number;
  currentOdometer: number; assignedTo?: { id: string; name: string } | null;
}

export interface FuelEntry {
  id: string; fuelType: string; liters: number; pricePerLiter: number | string; totalAmount: number | string;
  fuelStation: string; receiptNumber: string; odometerReading: number; paymentMethod: string;
  isFullTank: boolean;
  latitude?: number; longitude?: number; gpsAccuracy?: number; gpsCapturedAt?: string; stationLatitude?: number; stationLongitude?: number; stationDistanceMeters?: number; gpsStatus: string; status: FuelStatus; anomalyStatus: string;
  qrRawValue?: string; qrExtractedData?: Record<string, unknown>; qrStatus?: 'VERIFIED' | 'INVALID' | 'DUPLICATE' | 'UNVERIFIED'; qrScannedAt?: string;
  odometerDistance?: number; efficiencyKmL?: number; costPerKm?: number; variancePercent?: number;
  createdAt: string; purchasedAt?: string; reviewComment?: string; vehicle: Vehicle; salesperson?: { id: string; name: string };
  receipt?: { file: { originalName: string; storageKey: string; mimeType: string } };
  qrEvidence?: { file: { originalName: string; storageKey: string; mimeType: string } };
  fuelPhoto?: { file: { originalName: string; storageKey: string; mimeType: string } };
  previousEntry?: { id: string; createdAt: string; odometerReading: number; liters: number; totalAmount: string | number; fuelStation: string } | null;
}

export interface FuelDashboard {
  kpis: { monthlyBudget: number; totalCost: number; remainingBudget: number; liters: number; estimatedConsumed: number; distance: number; averageKmL: number; costPerKm: number; pending: number; rejected: number; suspicious: number };
  entries: FuelEntry[]; bySalesperson: { name: string; cost: number; liters: number }[];
  byVehicle: { name: string; cost: number; liters: number; distance: number; efficiencyKmL: number }[];
  monthlyTrend: { month: string; cost: number; liters: number; distance: number }[];
}

export interface DailyFuelRecord {
  id: string; recordDate: string; openedAt: string; closedAt?: string; status: 'OPEN' | 'CLOSED' | 'FLAGGED';
  openingFuelLiters: number; openingOdometer: number; fuelAddedLiters: number;
  closingFuelLiters?: number; closingOdometer?: number; distanceTravelled?: number; fuelUsedLiters?: number; fuelEfficiencyKmL?: number;
  openingLatitude: number; openingLongitude: number; openingGpsAccuracy?: number; closingLatitude?: number; closingLongitude?: number; closingGpsAccuracy?: number;
  anomalyReasons?: string[]; vehicle: Vehicle; salesperson: { id: string; name: string };
  photos: { kind: 'OPENING' | 'CLOSING'; file: { mimeType: string; originalName: string } }[];
  fuelEntries: { id: string; liters: number; totalAmount: number | string; receiptNumber: string }[];
}

export const fuelApi = {
  vehicles: () => apiRequest<Vehicle[]>('/api/v1/fuel/vehicles'),
  entries: (query = '') => apiRequest<{ items: FuelEntry[] }>(`/api/v1/fuel/entries?limit=100${query ? `&${query}` : ''}`),
  dashboard: () => apiRequest<FuelDashboard>('/api/v1/fuel/dashboard'),
  daily: (from?: string, to?: string) => apiRequest<DailyFuelRecord[]>(`/api/v1/fuel/daily${from ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to ?? from)}` : ''}`),
  startDaily: (data: Record<string, unknown>) => apiRequest<DailyFuelRecord>('/api/v1/fuel/daily/start', { method: 'POST', body: JSON.stringify(data) }),
  endDaily: (id: string, data: Record<string, unknown>) => apiRequest<DailyFuelRecord>(`/api/v1/fuel/daily/${id}/end`, { method: 'PATCH', body: JSON.stringify(data) }),
  uploadDailyPhoto: (id: string, kind: 'opening' | 'closing', photo: File) => { const body = new FormData(); body.append('photo', photo); return apiRequest(`/api/v1/fuel/daily/${id}/photo/${kind}`, { method: 'POST', body }); },
  dailyPhoto: (id: string, kind: 'opening' | 'closing') => apiBlob(`/api/v1/fuel/daily/${id}/photo/${kind}`),
  flagDaily: (id: string, reason: 'PHOTO_ENTRY_MISMATCH' | 'SUSPICIOUS_GPS' | 'OTHER') => apiRequest(`/api/v1/fuel/daily/${id}/flag`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  wallet: () => apiRequest<{ allowance: number; used: number; remaining: number; liters: number }>('/api/v1/fuel/wallet'),
  createEntry: (data: Record<string, unknown>) => apiRequest<{ id: string }>('/api/v1/fuel/entries', { method: 'POST', body: JSON.stringify(data) }),
  uploadReceipt: (id: string, receipt: File) => {
    const body = new FormData(); body.append('receipt', receipt);
    return apiRequest(`/api/v1/fuel/entries/${id}/receipt`, { method: 'POST', body });
  },
  uploadQrImage: (id: string, qrImage: File) => { const body = new FormData(); body.append('qrImage', qrImage); return apiRequest(`/api/v1/fuel/entries/${id}/qr-image`, { method: 'POST', body }); },
  uploadFuelPhoto: (id: string, fuelPhoto: File) => { const body = new FormData(); body.append('fuelPhoto', fuelPhoto); return apiRequest(`/api/v1/fuel/entries/${id}/fuel-photo`, { method: 'POST', body }); },
  detail: (id: string) => apiRequest<FuelEntry>(`/api/v1/fuel/entries/${id}`),
  submit: (id: string) => apiRequest(`/api/v1/fuel/entries/${id}/submit`, { method: 'POST' }),
  review: (id: string, status: FuelStatus, comment: string) => apiRequest(`/api/v1/fuel/entries/${id}/review`, { method: 'PATCH', body: JSON.stringify({ status, comment }) }),
  receipt: (id: string) => apiBlob(`/api/v1/fuel/entries/${id}/receipt`),
  qrImage: (id: string) => apiBlob(`/api/v1/fuel/entries/${id}/qr-image`),
  fuelPhoto: (id: string) => apiBlob(`/api/v1/fuel/entries/${id}/fuel-photo`),
  saveBudget: (companyAmount: number) => apiRequest('/api/v1/fuel/budget', { method: 'PUT', body: JSON.stringify({ companyAmount }) }),
  createVehicle: (data: Record<string, unknown>) => apiRequest('/api/v1/fuel/vehicles', { method: 'POST', body: JSON.stringify(data) }),
};
