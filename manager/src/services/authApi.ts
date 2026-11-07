import { User } from '../types';
import { apiRequest, setAccessToken } from './apiClient';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { getBiometricErrorMessage, performBiometricAction, type BiometricActionProgress } from './biometricAction';
import { biometricDiagnosticLog } from './biometricLog';

interface AuthResponse {
  accessToken: string;
  user: User;
}

export const loginWithApi = async (email: string, password: string) => {
  const response = await apiRequest<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, tenant: 'reproutes' }),
  });
  setAccessToken(response.accessToken);
  return response.user;
};

export const restoreApiSession = async () => {
  const response = await apiRequest<AuthResponse>('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  setAccessToken(response.accessToken);
  return response.user;
};

export const logoutFromApi = async () => {
  await apiRequest<void>('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
  setAccessToken(null);
};

export const supportsBiometricLogin = async () =>
  browserSupportsWebAuthn() && window.isSecureContext && await platformAuthenticatorIsAvailable();

export const loginWithPasskey = async () => {
  const ceremony = await apiRequest<{
    flowId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>('/api/v1/auth/passkey/login/options', { method: 'POST', body: JSON.stringify({}) });
  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON: ceremony.options });
  } catch (error) {
    biometricDiagnosticLog(error, {
      ceremony: 'authentication', rpId: ceremony.options.rpId,
      hasServerCredential: true, webAuthnSupported: browserSupportsWebAuthn(),
    });
    throw error;
  }
  const session = await apiRequest<AuthResponse>('/api/v1/auth/passkey/login/verify', {
    method: 'POST',
    body: JSON.stringify({ flowId: ceremony.flowId, response: assertion }),
  });
  setAccessToken(session.accessToken);
  localStorage.setItem('tf_passkey_registered', 'current-device-v1');
  return session.user;
};

export type { BiometricActionProgress };
export const verifyBiometricForAction = async (
  expectedUserId: string,
  onProgress: (progress: BiometricActionProgress) => void = () => undefined,
) => {
  let ceremony: 'registration' | 'authentication' | 'capability-check' = 'capability-check';
  let platformAvailable: boolean | undefined;
  let hasServerCredential: boolean | undefined;
  try {
    return await performBiometricAction(expectedUserId, {
      isSecureContext: window.isSecureContext,
      supported: browserSupportsWebAuthn,
      platformAvailable: async () => {
        platformAvailable = await platformAuthenticatorIsAvailable();
        return platformAvailable;
      },
      loadDevices: async () => {
        const devices = await loadPasskeyDevices();
        hasServerCredential = devices.length > 0;
        return devices;
      },
      register: () => {
        ceremony = 'registration';
        return registerPasskey((navigator.platform || 'Device') + ' · ' + new Date().toLocaleDateString());
      },
      login: () => {
        ceremony = 'authentication';
        return loginWithPasskey();
      },
    }, onProgress);
  } catch (error) {
    biometricDiagnosticLog(error, {
      ceremony, hasServerCredential, webAuthnSupported: browserSupportsWebAuthn(), platformAuthenticatorAvailable: platformAvailable,
    });
    throw error;
  }
};

export { getBiometricErrorMessage };

export const registerPasskey = async (deviceName: string) => {
  const ceremony = await apiRequest<{
    flowId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }>('/api/v1/auth/passkey/register/options', { method: 'POST', body: JSON.stringify({}) });
  let credential;
  try {
    credential = await startRegistration({ optionsJSON: ceremony.options });
  } catch (error) {
    biometricDiagnosticLog(error, {
      ceremony: 'registration', rpId: ceremony.options.rp.id,
      hasServerCredential: ceremony.options.excludeCredentials.length > 0,
      webAuthnSupported: browserSupportsWebAuthn(),
    });
    throw error;
  }
  const result = await apiRequest<{ verified: boolean; credentialId: string }>(
    '/api/v1/auth/passkey/register/verify',
    {
      method: 'POST',
      body: JSON.stringify({ flowId: ceremony.flowId, deviceName, response: credential }),
    },
  );
  localStorage.setItem('tf_passkey_registered', 'current-device-v1');
  return result;
};

export interface PasskeyDevice {
  credentialId: string;
  deviceName: string;
  credentialType: string;
  transports?: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export const loadPasskeyDevices = () =>
  apiRequest<PasskeyDevice[]>('/api/v1/auth/passkey/devices');

export const removePasskeyDevice = async (credentialId: string) => {
  await apiRequest<void>(`/api/v1/auth/passkey/devices/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
  });
};

export const requestRegistrationOtp = (input: { name: string; email: string; password: string }) =>
  apiRequest<{ message: string; expiresInMinutes: number }>('/api/v1/auth/register/request-otp', {
    method: 'POST',
    body: JSON.stringify({ ...input, tenant: 'reproutes' }),
  });

export const verifyRegistrationOtp = (email: string, code: string) =>
  apiRequest<{ message: string; user: User }>('/api/v1/auth/register/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, code, tenant: 'reproutes' }),
  });
