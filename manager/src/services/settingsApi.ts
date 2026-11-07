import { apiRequest } from './apiClient';

export type WorkingDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface TenantSettings {
  gpsTrackingEnabled: boolean;
  gpsUpdateIntervalSeconds: number;
  gpsAccuracyThresholdMeters: number;
  attendanceRequireGps: boolean;
  attendanceLateGraceMinutes: number;
  attendanceAllowManualEdits: boolean;
  workingStart: string;
  workingEnd: string;
  timezone: 'Asia/Colombo' | 'UTC';
  workingDays: WorkingDay[];
  geofenceEnabled: boolean;
  geofenceRadiusMeters: number;
  geofenceBlockOutside: boolean;
  commissionEnabled: boolean;
  commissionRatePercent: number;
  commissionMinimumRevenueLkr: number;
  sessionTimeoutMinutes: number;
  requirePasskeyForManagers: boolean;
  notifyLateArrival: boolean;
  notifyGeofenceViolation: boolean;
  notifyDailySummary: boolean;
  emailNotificationsEnabled: boolean;
  mapProvider: 'OPENSTREETMAP' | 'GOOGLE_MAPS';
  routingProvider: 'OSRM' | 'GOOGLE_DIRECTIONS';
  webhookEnabled: boolean;
  webhookUrl: string;
}

export const loadTenantSettings = () => apiRequest<TenantSettings>('/api/v1/settings');

export const saveTenantSettings = (settings: TenantSettings) =>
  apiRequest<TenantSettings>('/api/v1/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
