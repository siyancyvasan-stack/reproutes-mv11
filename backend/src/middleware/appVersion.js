import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

export const requireAppVersion = (req, res, next) => {
    const platform = req.headers['x-app-platform'];
    const version = req.headers['x-app-version'];

    if (!platform || !version) {
        // If strict version checking is required for all requests, return 400 here.
        // Usually, we just pass if the headers are missing for backward compatibility
        // or web requests that don't send it.
        return next();
    }

    let minVersion = null;
    let updateUrl = null;

    if (platform === 'android') {
        minVersion = env.MIN_APP_VERSION_ANDROID;
        updateUrl = env.UPDATE_URL_ANDROID;
    } else if (platform === 'ios') {
        minVersion = env.MIN_APP_VERSION_IOS;
        updateUrl = env.UPDATE_URL_IOS;
    } else if (platform === 'web') {
        minVersion = env.MIN_APP_VERSION_WEB;
    }

    if (minVersion && compareVersions(version, minVersion) < 0) {
        logger.warn({ platform, version, minVersion }, 'Outdated app version rejected');
        return res.status(426).json({
            error: {
                code: 'UPGRADE_REQUIRED',
                message: 'Your app version is no longer supported. Please update to the latest version.',
                details: {
                    minimumRequired: minVersion,
                    updateUrl
                }
            }
        });
    }

    next();
};
