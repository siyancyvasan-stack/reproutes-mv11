/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
  readonly VITE_MAP_PROVIDER?: 'google' | 'openstreetmap';
  readonly APP_VERSION?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_MANAGER_APP_VERSION?: string;
  readonly VITE_SALES_APP_VERSION?: string;
  readonly VITE_FACTORY_APP_VERSION?: string;
  readonly VITE_MANAGER_PORTAL_HOST?: string;
  readonly VITE_SALES_PORTAL_HOST?: string;
  readonly VITE_FACTORY_PORTAL_HOST?: string;
  readonly VITE_TRACKING_WS_URL?: string;
  readonly VITE_TRACKING_SOCKET_URL?: string;
  readonly VITE_GPS_POOR_ACCURACY_METERS?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_ANDROID_APK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
