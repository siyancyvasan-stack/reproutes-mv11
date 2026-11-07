import { classifyWebAuthnError, webAuthnErrorChain } from './biometricAction';

export type BiometricCeremony = 'registration' | 'authentication' | 'capability-check';

export interface BiometricDiagnosticContext {
  ceremony: BiometricCeremony;
  rpId?: string;
  hasServerCredential?: boolean;
  webAuthnSupported: boolean;
  platformAuthenticatorAvailable?: boolean;
}

const loggedErrors = new WeakSet<object>();

export const biometricDiagnosticLog = (error: unknown, context: BiometricDiagnosticContext) => {
  if (!import.meta.env.DEV) return;
  if (error && typeof error === 'object') {
    if (loggedErrors.has(error)) return;
    loggedErrors.add(error);
  }
  const chain = webAuthnErrorChain(error);
  const root = chain.at(-1) ?? chain[0];
  console.error('[Reproutes WebAuthn] ceremony failed', {
    category: classifyWebAuthnError(error),
    errorName: root?.name ?? 'UnknownError',
    errorMessage: root?.message ?? (error instanceof Error ? error.message : String(error)),
    errorConstructor: error && typeof error === 'object' ? error.constructor?.name : typeof error,
    origin: window.location.origin,
    secureContext: window.isSecureContext,
    ...context,
  });
};
