import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Role } from './enums.js';
import { env } from '../config/env.js';
import { z } from 'zod';
export const signAccessToken = (claims) => jwt.sign({ ...claims, tokenType: 'access' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
});
const accessClaimsSchema = z.object({
    sub: z.string().min(1),
    tenantId: z.string().min(1),
    role: z.nativeEnum(Role),
    email: z.string().email(),
    tokenType: z.literal('access'),
});
export const verifyAccessToken = (token) => accessClaimsSchema.parse(jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
}));
export const createRefreshToken = () => crypto.randomBytes(48).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
