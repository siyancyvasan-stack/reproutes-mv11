export type AndroidApkConfig =
  | { available: true; url: string }
  | { available: false; reason: string };

export const getAndroidApkConfig = (configuredUrl?: string): AndroidApkConfig => {
  const value = configuredUrl?.trim();
  if (!value) {
    return { available: false, reason: 'Android app download is being prepared.' };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return { available: false, reason: 'The Android download must use HTTPS.' };
    }
    return { available: true, url: url.toString() };
  } catch {
    return { available: false, reason: 'The Android download URL is invalid.' };
  }
}
