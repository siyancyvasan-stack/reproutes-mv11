import { env } from '../../config/env.js';
import { getRedis, redisEnabled } from '../../lib/redis.js';

const memoryPresence = new Map();

const key = (tenantId, userId) => `${env.REDIS_KEY_PREFIX}presence:${tenantId}:${userId}`;
const cutoff = () => Date.now() - (env.SOCKET_PRESENCE_TTL_SECONDS || 60) * 1_000;

const pruneAndCountMemory = (tenantId, userId) => {
    const k = key(tenantId, userId);
    const sockets = memoryPresence.get(k);
    if (!sockets) return 0;
    const expiry = cutoff();
    for (const [sId, time] of sockets.entries()) {
        if (time <= expiry) sockets.delete(sId);
    }
    if (sockets.size === 0) {
        memoryPresence.delete(k);
        return 0;
    }
    return sockets.size;
};

const pruneAndCount = async (tenantId, userId) => {
    if (!redisEnabled()) {
        return pruneAndCountMemory(tenantId, userId);
    }
    try {
        const redis = getRedis();
        const presenceKey = key(tenantId, userId);
        await redis.zRemRangeByScore(presenceKey, 0, cutoff());
        return redis.zCard(presenceKey);
    } catch {
        return pruneAndCountMemory(tenantId, userId);
    }
};

export const touchPresence = async (tenantId, userId, socketId) => {
    const k = key(tenantId, userId);
    let sockets = memoryPresence.get(k);
    if (!sockets) {
        sockets = new Map();
        memoryPresence.set(k, sockets);
    }
    sockets.set(socketId, Date.now());

    if (!redisEnabled())
        return;
    try {
        const presenceKey = key(tenantId, userId);
        await getRedis().multi()
            .zAdd(presenceKey, { score: Date.now(), value: socketId })
            .zRemRangeByScore(presenceKey, 0, cutoff())
            .expire(presenceKey, (env.SOCKET_PRESENCE_TTL_SECONDS || 60) * 2)
            .exec();
    } catch {
        // In-memory presence recorded as fallback
    }
};

export const removePresence = async (tenantId, userId, socketId) => {
    const k = key(tenantId, userId);
    const sockets = memoryPresence.get(k);
    if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) memoryPresence.delete(k);
    }
    if (!redisEnabled())
        return pruneAndCountMemory(tenantId, userId) > 0;
    try {
        await getRedis().zRem(key(tenantId, userId), socketId);
        return (await pruneAndCount(tenantId, userId)) > 0;
    } catch {
        return pruneAndCountMemory(tenantId, userId) > 0;
    }
};

export const isUserPresent = async (tenantId, userId) => {
    return (await pruneAndCount(tenantId, userId)) > 0;
};

export const getPresentUsers = async (tenantId, userIds) => {
    if (userIds.length === 0)
        return new Set();
    const counts = await Promise.all(userIds.map((userId) => pruneAndCount(tenantId, userId)));
    return new Set(userIds.filter((_userId, index) => counts[index] > 0));
};
