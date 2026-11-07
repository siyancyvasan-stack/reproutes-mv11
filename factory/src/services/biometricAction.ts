export type BiometricActionProgress = 'registering' | 'authenticating';

export type BiometricActionDependencies<User extends { id: string }, Device> = {
  isSecureContext: boolean;
  supported: () => boolean;
  platformAvailable: () => Promise<boolean>;
  loadDevices: () => Promise<Device[]>;
  register: () => Promise<unknown>;
  login: () => Promise<User>;
};

export const performBiometricAction = async <User extends { id: string }, Device>(
  expectedUserId: string,
  dependencies: BiometricActionDependencies<User, Device>,
  onProgress: (progress: BiometricActionProgress) => void = () => undefined,
) => {
  if (!dependencies.isSecureContext) {
    throw new Error('Fingerprint requires HTTPS or localhost.');
  }
  if (!dependencies.supported()) {
    throw new Error('Fingerprint authentication is not supported by this browser.');
  }
  if (!await dependencies.platformAvailable()) {
    throw new Error('Fingerprint is unavailable here. Use a phone with screen lock enabled or configure Windows Hello.');
  }
  const devices = await dependencies.loadDevices();
  if (!devices.length) {
    onProgress('registering');
    await dependencies.register();
    return 'registered' as const;
  }
  onProgress('authenticating');
  const verifiedUser = await dependencies.login();
  if (verifiedUser.id !== expectedUserId) {
    throw new Error('Biometric credential does not belong to the signed-in salesperson.');
  }
  return 'authenticated' as const;
};

type WebAuthnErrorLike = {
  name?: string;
  message?: string;
  cause?: unknown;
};

export const webAuthnErrorChain = (error: unknown) => {
  const chain: WebAuthnErrorLike[] = [];
  let current = error;
  for (let index = 0; index < 3 && current && typeof current === 'object'; index += 1) {
    const candidate = current as WebAuthnErrorLike;
    chain.push(candidate);
    current = candidate.cause;
  }
  return chain;
};

export type WebAuthnErrorCategory =
  | 'NotAllowedError'
  | 'AbortError'
  | 'InvalidStateError'
  | 'SecurityError'
  | 'NotSupportedError'
  | 'ConstraintError'
  | 'UnknownError';

const knownCategories = new Set<WebAuthnErrorCategory>([
  'NotAllowedError', 'AbortError', 'InvalidStateError', 'SecurityError',
  'NotSupportedError', 'ConstraintError', 'UnknownError',
]);

export const classifyWebAuthnError = (error: unknown): WebAuthnErrorCategory => {
  const chain = webAuthnErrorChain(error);
  const named = chain.find((item) => knownCategories.has(item.name as WebAuthnErrorCategory));
  if (named?.name) return named.name as WebAuthnErrorCategory;
  if (chain.some((item) => /timed out or was not allowed|notallowederror/i.test(item.message ?? ''))) return 'NotAllowedError';
  return 'UnknownError';
};

export const isWebAuthnNotAllowedError = (error: unknown) =>
  webAuthnErrorChain(error).some((item) =>
    item.name === 'NotAllowedError'
    || /timed out or was not allowed|notallowederror/i.test(item.message ?? ''),
  );

export const getBiometricErrorMessage = (error: unknown) => {
  const chain = webAuthnErrorChain(error);
  const category = classifyWebAuthnError(error);
  if (category === 'NotAllowedError' || category === 'AbortError') {
    return 'Passkey prompt timed out or was cancelled. Chrome Device Mode does not simulate fingerprint; complete the device PIN/fingerprint prompt or use a real phone.';
  }
  if (category === 'InvalidStateError') {
    return 'This passkey already exists on this device. Remove the old passkey in Profile settings and retry.';
  }
  if (category === 'SecurityError') return 'Fingerprint verification is blocked by the current origin or RP ID configuration.';
  if (category === 'NotSupportedError') return 'Fingerprint authentication is not supported by this browser or device.';
  if (category === 'ConstraintError') return 'This device cannot satisfy the required fingerprint security settings.';
  const message = chain.map((item) => item.message).find(Boolean);
  return message && !message.includes('w3.org/TR/webauthn')
    ? message
    : 'Fingerprint verification could not be completed. Please retry on a device with a configured screen lock.';
};
