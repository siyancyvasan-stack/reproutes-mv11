import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redisEnabled, sendRedisCommand } from '../lib/redis.js';
export const distributedRateLimit = (name, options) => rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    // Redis is an optimization for distributed limits. An outage must not take
    // down authentication or the API in a serverless invocation.
    passOnStoreError: true,
    ...options,
    ...(redisEnabled() ? {
        store: new RedisStore({
            prefix: `${env.REDIS_KEY_PREFIX}rate-limit:${name}:`,
            sendCommand: (...args) => sendRedisCommand(args),
        }),
    } : {}),
});
