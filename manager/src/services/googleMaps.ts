import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

export type GoogleMapsConfigIssue = 'missing-key' | 'invalid-key' | 'missing-map-id';

export const GOOGLE_MAPS_AUTH_FAILURE_EVENT = 'sales-sphere:google-maps-auth-failure';

let mapsPromise:
  | Promise<{
      maps: google.maps.MapsLibrary;
      marker: google.maps.MarkerLibrary;
      routes: google.maps.RoutesLibrary;
    }>
  | undefined;
let authFailureHandlerInstalled = false;
let googleMapsAuthFailed = false;
let googleMapsAuthFailureDispatched = false;

export const getGoogleMapsConfigIssue = (apiKey?: string, mapId?: string): GoogleMapsConfigIssue | null => {
  const normalizedKey = apiKey?.trim() ?? '';
  if (!normalizedKey) return 'missing-key';
  if (
    normalizedKey.includes('VITE_GOOGLE_MAPS_API_KEY=') ||
    /x{6,}/i.test(normalizedKey) ||
    !/^AIza[0-9A-Za-z_-]{30,}$/.test(normalizedKey)
  ) return 'invalid-key';
  if (!mapId?.trim()) return 'missing-map-id';
  return null;
};

export const getGoogleMapsConfigError = (issue: GoogleMapsConfigIssue) => {
  if (issue === 'missing-key') return 'VITE_GOOGLE_MAPS_API_KEY is missing from the frontend environment.';
  if (issue === 'invalid-key') return 'VITE_GOOGLE_MAPS_API_KEY is malformed or still contains a placeholder value.';
  return 'VITE_GOOGLE_MAPS_MAP_ID is required for Google Maps advanced markers.';
};

export const getGoogleMapsAuthError = () =>
  `Google Maps rejected this API key for ${window.location.origin}. Add ${window.location.origin}/* ` +
  'to the key\'s allowed HTTP referrers, and verify billing and the enabled Maps APIs.';

const installGoogleMapsAuthFailureHandler = () => {
  if (authFailureHandlerInstalled) return;
  authFailureHandlerInstalled = true;
  const mapsWindow = window as typeof window & { gm_authFailure?: () => void };
  const previousHandler = mapsWindow.gm_authFailure;
  mapsWindow.gm_authFailure = () => {
    googleMapsAuthFailed = true;
    previousHandler?.();
    console.error('[Reproutes Map] Google Maps authentication failure', {
      origin: window.location.origin,
      message: getGoogleMapsAuthError(),
    });
    if (!googleMapsAuthFailureDispatched) {
      googleMapsAuthFailureDispatched = true;
      window.dispatchEvent(new Event(GOOGLE_MAPS_AUTH_FAILURE_EVENT));
    }
  };
};

export const loadGoogleMaps = (apiKey: string) => {
  if (googleMapsAuthFailed) return Promise.reject(new Error(getGoogleMapsAuthError()));
  if (!mapsPromise) {
    installGoogleMapsAuthFailureHandler();
    setOptions({ key: apiKey, v: 'weekly', libraries: ['maps', 'marker', 'routes'] });
    mapsPromise = Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('routes'),
    ]).then(([maps, marker, routes]) => ({ maps, marker, routes }));
  }
  return mapsPromise;
};
