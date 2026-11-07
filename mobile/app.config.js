// Expo sets NODE_ENV=production while exporting optimized bundles, including
// local verification. EAS_BUILD_PROFILE identifies an actual release profile.
const productionBuild = ['production', 'production-apk'].includes(process.env.EAS_BUILD_PROFILE ?? '');
const productionApiUrl = 'https://api.reproutes.com';
const productionWebUrl = 'https://reproutes.com';
const configuredApiUrl = productionBuild
  ? productionApiUrl
  : process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');

// EAS project commands inspect config with dotenv disabled. Use a harmless
// discovery fallback locally; cloud builds still require an explicit origin.
const actualEasBuild = process.env.EAS_BUILD === 'true';
const apiUrl = configuredApiUrl || 'http://127.0.0.1:4001';
if (!configuredApiUrl && actualEasBuild) {
  throw new Error('EXPO_PUBLIC_API_URL is required. Define it in the EAS build environment.');
}
if (!URL.canParse(apiUrl) || !/^https?:\/\//i.test(apiUrl)) {
  throw new Error('EXPO_PUBLIC_API_URL must be a valid HTTP(S) origin.');
}
if (productionBuild && (!apiUrl.startsWith('https://') || /(?:localhost|127\.0\.0\.1|10\.0\.2\.2)/i.test(apiUrl))) {
  throw new Error('EXPO_PUBLIC_API_URL must be a public HTTPS URL for production builds');
}

module.exports = ({ config }) => ({
  ...config,
  name: 'repRoutes',
  slug: 'reproutes-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'reproutes',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.reproutes.mobile',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'repRoutes uses your location to record sales visits and routes during an active shift.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'repRoutes records your route in the background only while your work shift is active.',
      NSFaceIDUsageDescription: 'Use Face ID to confirm secure repRoutes actions.',
      UIBackgroundModes: ['location', 'remote-notification'],
    },
  },
  android: {
    package: 'com.reproutes.mobile',
    usesCleartextTraffic: !productionBuild,
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
    ],
  },
  plugins: [
    'expo-dev-client',
    'expo-secure-store',
    ['expo-local-authentication', {
      faceIDPermission: 'Allow Reproutes to use Face ID to verify secure attendance actions.',
    }],
    ['expo-location', {
      locationAlwaysAndWhenInUsePermission: 'Allow Reproutes to record sales routes while a shift is active.',
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
    }],
    ['expo-notifications', { color: '#2563eb' }],
  ],
  extra: {
    apiUrl,
    webUrl: productionBuild
      ? productionWebUrl
      : process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, '') || apiUrl.replace(/:4001$/, ':4000'),
    tenantSlug: productionBuild ? 'reproutes' : process.env.EXPO_PUBLIC_TENANT_SLUG ?? 'reproutes-demo',
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '988acd29-cd48-462f-80c7-53f1768cc506' },
  },
});
