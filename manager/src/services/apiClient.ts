const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || 'same-origin';
const API_URL =
  configuredApiUrl === 'same-origin' ? '' : configuredApiUrl?.replace(/\/$/, '');
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let refreshRetryAfter = 0;

export const SESSION_EXPIRED_EVENT = 'reproutes:session-expired';

const expireSession = () => {
  accessToken = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isBackendConfigured = true;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

const refreshAccessToken = async () => {
  if (!isBackendConfigured) return false;
  if (Date.now() < refreshRetryAfter) return false;
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        if (!response.ok) {
          accessToken = null;
          if (response.status === 401 || response.status === 403) expireSession();
          else refreshRetryAfter = Date.now() + 5_000;
          return false;
        }
        const payload = await response.json();
        setAccessToken(payload.accessToken);
        refreshRetryAfter = 0;
        return true;
      })
      .catch(() => {
        accessToken = null;
        refreshRetryAfter = Date.now() + 5_000;
        return false;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

/**
 * Restore the in-memory access token from the refresh cookie before opening
 * authenticated transports such as Socket.IO.
 */
export const ensureAccessToken = async () => {
  if (accessToken) return accessToken;
  if (!(await refreshAccessToken()) || !accessToken) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  return accessToken;
};

/** Force a fresh access token after an authenticated long-lived transport expires. */
export const refreshSessionAccessToken = async () => {
  if (!(await refreshAccessToken()) || !accessToken) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  return accessToken;
};

export const apiRequest = async <T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> => {
  if (!isBackendConfigured) throw new Error('Backend is not configured');
  if (!accessToken && !path.includes('/auth/')) {
    const restored = await refreshAccessToken();
    if (!restored) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
  }
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });

  if (response.status === 401 && retry && !path.includes('/auth/')) {
    if (await refreshAccessToken()) return apiRequest<T>(path, init, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'API_REQUEST_FAILED',
      payload?.error?.message ?? `API request failed (${response.status})`,
      payload?.error?.details,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

export const apiBlob = async (path: string, retry = true): Promise<Blob> => {
  if (!accessToken && !(await refreshAccessToken())) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (response.status === 401 && retry && await refreshAccessToken()) return apiBlob(path, false);
  if (!response.ok) {
    throw new ApiError(response.status, 'FILE_DOWNLOAD_FAILED', 'The requested file could not be downloaded');
  }
  return response.blob();
};

export const apiDownload = async (path: string, retry = true): Promise<{ blob: Blob; filename?: string }> => {
  if (!accessToken && !(await refreshAccessToken())) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
  if (response.status === 401 && retry && await refreshAccessToken()) return apiDownload(path, false);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, payload?.error?.code ?? 'FILE_DOWNLOAD_FAILED', payload?.error?.message ?? 'The requested file could not be downloaded');
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return { blob: await response.blob(), filename };
};
