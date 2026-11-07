import { randomUUID } from 'node:crypto';
import db from './db.js';
import { logger } from '../config/logger.js';

export const DEVICE_SESSION_ONLINE_THRESHOLD_MS = 5 * 60 * 1_000; 

export function parseUserAgent(ua) {
    if (!ua || ua.trim() === '') {
        return {
            deviceType: 'Unknown', os: 'Unknown', osVersion: null,
            browser: 'Unknown', browserVersion: null, platform: 'web',
        };
    }
    const s = ua;
    let deviceType = 'Desktop';
    if (/tablet|ipad/i.test(s)) deviceType = 'Tablet';
    else if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(s)) deviceType = 'Mobile';
    
    let os = 'Unknown', osVersion = null;
    if (/android/i.test(s)) {
        os = 'Android';
        const m = /Android[\s/]([\d.]+)/i.exec(s);
        osVersion = m?.[1] ?? null;
    } else if (/iphone|ipad|ipod/i.test(s)) {
        os = 'iOS';
        const m = /OS ([\d_]+)/i.exec(s);
        osVersion = m?.[1]?.replace(/_/g, '.') ?? null;
    } else if (/windows nt/i.test(s)) {
        os = 'Windows';
        const m = /Windows NT ([\d.]+)/i.exec(s);
        const ntMap = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
        osVersion = (m?.[1] ? ntMap[m[1]] ?? m[1] : null);
    } else if (/macintosh|mac os x/i.test(s)) {
        os = 'macOS';
        const m = /Mac OS X ([\d_]+)/i.exec(s);
        osVersion = m?.[1]?.replace(/_/g, '.') ?? null;
    } else if (/linux/i.test(s)) {
        os = 'Linux';
    }
    
    let platform = 'web';
    if (/ReactNative|ExpoGo|tracksale-mobile/i.test(s) || os === 'Android' || os === 'iOS') {
        platform = 'mobile';
    }
    
    let browser = 'Unknown', browserVersion = null;
    if (/edg\//i.test(s)) {
        browser = 'Edge';
        const m = /Edg\/([\d.]+)/i.exec(s);
        browserVersion = m?.[1] ?? null;
    } else if (/samsungbrowser/i.test(s)) {
        browser = 'Samsung';
        const m = /SamsungBrowser\/([\d.]+)/i.exec(s);
        browserVersion = m?.[1] ?? null;
    } else if (/firefox\//i.test(s)) {
        browser = 'Firefox';
        const m = /Firefox\/([\d.]+)/i.exec(s);
        browserVersion = m?.[1] ?? null;
    } else if (/opr\/|opera\//i.test(s)) {
        browser = 'Other';
        browserVersion = null;
    } else if (/chrome\//i.test(s)) {
        browser = 'Chrome';
        const m = /Chrome\/([\d.]+)/i.exec(s);
        browserVersion = m?.[1]?.split('.')[0] ?? null;
    } else if (/safari\//i.test(s) && /version\//i.test(s)) {
        browser = 'Safari';
        const m = /Version\/([\d.]+)/i.exec(s);
        browserVersion = m?.[1] ?? null;
    } else if (!/mozilla/i.test(s)) {
        browser = 'Other';
    }
    return { deviceType, os, osVersion, browser, browserVersion, platform };
}

function anonymiseIp(ip) {
    if (!ip) return null;
    const ipv4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
    if (ipv4) return `${ipv4[1]}.0`;
    if (ip.includes(':')) {
        const groups = ip.split(':');
        return groups.slice(0, 4).join(':') + '::';
    }
    return null;
}

export async function createDeviceSession(input) {
    try {
        const parsed = parseUserAgent(input.userAgent);
        const rawPlatform = (input.clientPlatform ?? '').toLowerCase();
        const platform = rawPlatform === 'mobile' ? 'mobile' : rawPlatform === 'desktop' ? 'desktop' : parsed.platform;
        
        const id = randomUUID();
        await db.query(
            `INSERT INTO DeviceSession (id, tenantId, userId, deviceType, os, osVersion, browser, browserVersion, platform, userAgent, appVersion, ipAddress, isActive, loginAt, lastActiveAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())`,
            [id, input.tenantId, input.userId, parsed.deviceType, parsed.os, parsed.osVersion, parsed.browser, parsed.browserVersion, platform, input.userAgent?.slice(0, 512) ?? null, input.appVersion?.slice(0, 64) ?? null, anonymiseIp(input.ip), true]
        );
        return id;
    } catch (err) {
        logger.warn({ err, userId: input.userId }, 'DeviceSession creation failed (non-blocking)');
        return null;
    }
}

export async function touchDeviceSession(userId, tenantId, appVersion) {
    try {
        const [rows] = await db.query(
            'SELECT id FROM DeviceSession WHERE userId = ? AND tenantId = ? AND isActive = ? ORDER BY lastActiveAt DESC LIMIT 1',
            [userId, tenantId, true]
        );
        if (rows.length === 0) return;
        
        let q = 'UPDATE DeviceSession SET lastActiveAt = NOW(), updatedAt = NOW()';
        const params = [];
        if (appVersion) {
            q += ', appVersion = ?';
            params.push(appVersion.slice(0, 64));
        }
        q += ' WHERE id = ?';
        params.push(rows[0].id);
        
        await db.query(q, params);
    } catch (err) {
        logger.warn({ err, userId }, 'DeviceSession touch failed (non-blocking)');
    }
}

export async function closeDeviceSessions(userId) {
    try {
        await db.query(
            'UPDATE DeviceSession SET isActive = ?, loggedOutAt = NOW(), updatedAt = NOW() WHERE userId = ? AND isActive = ?',
            [false, userId, true]
        );
    } catch (err) {
        logger.warn({ err, userId }, 'DeviceSession close failed (non-blocking)');
    }
}

export async function getLatestDeviceSession(userId, tenantId) {
    try {
        const [rows] = await db.query(
            'SELECT deviceType, os, osVersion, browser, browserVersion, platform, appVersion, isActive, loginAt, lastActiveAt, loggedOutAt FROM DeviceSession WHERE userId = ? AND tenantId = ? ORDER BY lastActiveAt DESC LIMIT 1',
            [userId, tenantId]
        );
        return rows[0] || null;
    } catch {
        return null;
    }
}

export async function getDeviceSessionsForUsers(userIds, tenantId) {
    const map = new Map();
    if (userIds.length === 0) return map;
    try {
        const placeholders = userIds.map(() => '?').join(',');
        const q = `
            SELECT * FROM (
                SELECT userId, deviceType, os, osVersion, browser, browserVersion, platform, appVersion, isActive, loginAt, lastActiveAt, loggedOutAt,
                ROW_NUMBER() OVER(PARTITION BY userId ORDER BY lastActiveAt DESC) as rn
                FROM DeviceSession
                WHERE tenantId = ? AND userId IN (${placeholders})
            ) sub WHERE rn = 1
        `;
        const [sessions] = await db.query(q, [tenantId, ...userIds]);
        for (const s of sessions) {
            delete s.rn;
            map.set(s.userId, s);
        }
    } catch (err) {
        logger.warn({ err, tenantId }, 'getDeviceSessionsForUsers failed (non-blocking)');
    }
    return map;
}
