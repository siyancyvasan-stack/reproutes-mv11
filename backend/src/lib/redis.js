import { createClient } from 'redis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
let commandClient;
let connectPromise;
const buildClient = (purpose) => {
    const client = createClient({
        url: env.REDIS_URL,
        socket: {
            connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
            // Bound retries inside short-lived serverless invocations. Later
            // requests can create/reconnect the singleton again.
            reconnectStrategy: (retries) => retries >= 2 ? false : Math.min(100 * 2 ** retries, 1_000),
        },
    });
    client.on('error', (error) => logger.error({ err: error, purpose }, 'Redis client error'));
    client.on('reconnecting', () => logger.warn({ purpose }, 'Redis client reconnecting'));
    client.on('ready', () => logger.info({ purpose }, 'Redis client ready'));
    return client;
};
export const redisEnabled = () => Boolean(env.REDIS_URL);
export const getRedis = () => {
    if (!env.REDIS_URL)
        throw new Error('Redis is not configured');
    commandClient ??= buildClient('commands');
    return commandClient;
};
export const connectRedis = async () => {
    if (!redisEnabled()) {
        logger.warn('Redis is disabled; distributed features are unavailable');
        return;
    }
    const client = getRedis();
    if (!client.isReady) {
        connectPromise ??= (client.isOpen ? Promise.resolve() : client.connect())
            .then(() => undefined)
            .finally(() => { connectPromise = undefined; });
        await connectPromise;
    }
    await client.ping();
};
export const sendRedisCommand = async (args) => {
    await connectRedis();
    return getRedis().sendCommand(args);
};
export const createRedisSubscriber = async () => {
    const subscriber = getRedis().duplicate();
    subscriber.on('error', (error) => logger.error({ err: error, purpose: 'subscriber' }, 'Redis subscriber error'));
    await subscriber.connect();
    return subscriber;
};
export const checkRedisReadiness = async () => {
    if (!redisEnabled())
        return { enabled: false };
    const startedAt = performance.now();
    await connectRedis();
    await getRedis().ping();
    return { enabled: true, latencyMs: Math.round(performance.now() - startedAt) };
};
export const closeRedis = async (...additionalClients) => {
    const clients = [...additionalClients, commandClient].filter((client) => Boolean(client?.isOpen));
    await Promise.allSettled(clients.map((client) => client.quit()));
    commandClient = undefined;
    connectPromise = undefined;
};
