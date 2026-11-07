/**
 * mobile-biometric.routes.ts
 *
 * Two endpoints for the mobile passwordless biometric login flow.
 * These are intentionally separate from the web WebAuthn/passkey routes
 * and do NOT modify any existing auth infrastructure.
 *
 * Flow:
 *   1. POST /enroll   — called once after a successful password login.
 *                       Requires a valid Bearer token (user already authenticated).
 *                       Stores a device-specific token hash; returns the raw token
 *                       to be stored in the device Secure Enclave only.
 *
 *   2. POST /login    — called on subsequent biometric logins (no password).
 *                       Accepts the raw device token.
 *                       Validates hash, user active status, token not revoked.
 *                       Issues a real access + refresh token session.
 *
 * Security:
 *   - Raw token: crypto.randomBytes(48) — 384-bit entropy, base64url encoded.
 *   - Only SHA-256 hash stored in DB; raw token never persisted server-side.
 *   - clientType is always 'MOBILE' — prevents cross-client token reuse.
 *   - One active token per deviceId per user (older token revoked on re-enroll).
 *   - Account must be ACTIVE at login time.
 *   - Rate-limited: 10 enroll + 10 login attempts per 15 min per IP.
 */
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { authenticate } from '../../middleware/auth.js';
import { distributedRateLimit } from '../../middleware/distributedRateLimit.js';
import db from '../../lib/db.js';
import { createAuthenticatedSession } from './auth.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../config/logger.js';
import { randomUUID } from 'node:crypto';

export const mobileBiometricRouter = Router();

const biometricLimiter = distributedRateLimit('mobile-biometric', {
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'BIOMETRIC_RATE_LIMITED',
            message: 'Too many biometric attempts. Please wait a few minutes and try again.',
        },
    },
});

// ─── Hash helper (same as existing jwt.ts) ────────────────────────────────────
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// ─── POST /enroll ─────────────────────────────────────────────────────────────
// Called once after password login: registers a device-specific credential.
// Returns the raw token ONE TIME — must be stored in SecureStore immediately.
mobileBiometricRouter.post('/enroll', biometricLimiter, authenticate, // requires valid Bearer access token
async (req, res) => {
    const input = z.object({
        deviceId: z.string().uuid('deviceId must be a UUID'),
        deviceName: z.string().trim().min(1).max(120).default('Mobile Device'),
        platform: z.enum(['android', 'ios']).optional(),
    }).parse(req.body);

    const [users] = await db.query(
        'SELECT id, tenantId FROM User WHERE id = ? AND tenantId = ? AND status = ? LIMIT 1',
        [req.auth.sub, req.auth.tenantId, 'ACTIVE']
    );
    const user = users[0];

    if (!user) {
        throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active.');
    }

    // Revoke any existing active token for this deviceId on this account
    await db.query(
        'UPDATE MobileAuthToken SET revokedAt = NOW(), revokeReason = ? WHERE userId = ? AND deviceId = ? AND revokedAt IS NULL',
        ['RE_ENROLLED', user.id, input.deviceId]
    );

    // Generate new 384-bit token
    const rawToken = crypto.randomBytes(48).toString('base64url');
    const tokenHash = hashToken(rawToken);
    
    await db.query(
        'INSERT INTO MobileAuthToken (id, tenantId, userId, tokenHash, deviceId, deviceName, platform) VALUES (?, ?, ?, ?, ?, ?)',
        [user.tenantId, user.id, tokenHash, input.deviceId, input.deviceName, input.platform ?? null]
    );

    logger.info({ event: 'biometric-enrolled', userId: user.id, deviceId: input.deviceId, ip: req.ip }, 'Mobile biometric credential enrolled');

    // Return raw token ONCE — client must store it in SecureStore immediately
    return res.status(201).json({
        deviceToken: rawToken,
        message: 'Biometric login enabled for this device.',
    });
});

// ─── POST /login ──────────────────────────────────────────────────────────────
// Passwordless biometric login: validate device token → issue real session.
mobileBiometricRouter.post('/login', biometricLimiter, async (req, res) => {
    const input = z.object({
        deviceToken: z.string().min(32, 'Invalid device token'),
        tenant: z.string().min(2).default('reproutes-demo'),
    }).parse(req.body);

    const tokenHash = hashToken(input.deviceToken);
    
    const [records] = await db.query(
        'SELECT m.*, u.id as u_id, u.tenantId as u_tenantId, u.role as u_role, u.email as u_email, u.status as u_status, u.name as u_name FROM MobileAuthToken m JOIN User u ON m.userId = u.id WHERE m.tokenHash = ? LIMIT 1',
        [tokenHash]
    );
    const record = records[0];

    // Unified error — never leak which part failed
    const reject = () => new AppError(401, 'BIOMETRIC_INVALID', 'Biometric credential is invalid, expired, or revoked.');

    if (!record) throw reject();
    if (record.revokedAt) throw reject();
    if (record.u_status !== 'ACTIVE') throw reject();
    if (record.u_tenantId !== record.tenantId) throw reject();

    // Tenant slug check (prevents cross-tenant credential reuse)
    const [tenants] = await db.query(
        'SELECT id FROM Tenant WHERE id = ? AND slug = ? LIMIT 1',
        [record.tenantId, input.tenant]
    );
    const tenant = tenants[0];
    
    if (!tenant) throw reject();

    // Update last-used timestamp (non-blocking; failure does not abort login)
    db.query('UPDATE MobileAuthToken SET lastUsedAt = NOW() WHERE tokenHash = ?', [tokenHash]).catch(() => undefined);

    logger.info({ event: 'biometric-login', userId: record.userId, deviceId: record.deviceId, ip: req.ip }, 'Mobile biometric login succeeded');

    const user = { id: record.u_id, tenantId: record.u_tenantId, role: record.u_role, email: record.u_email, name: record.u_name, status: record.u_status };

    // Issue a full session — identical to password login, clientType MOBILE
    const session = await createAuthenticatedSession(user, { ip: req.ip, userAgent: req.headers['user-agent'], clientType: 'MOBILE' });

    // Mobile: return refreshToken in JSON body (same as password login for MOBILE)
    return res.json({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: session.user,
    });
});

// ─── DELETE /enroll/:deviceId ─────────────────────────────────────────────────
// Revoke biometric credential for a specific device (authenticated user only).
mobileBiometricRouter.delete('/enroll/:deviceId', authenticate, async (req, res) => {
    const deviceId = String(req.params.deviceId);

    const [updateResult] = await db.query(
        'UPDATE MobileAuthToken SET revokedAt = NOW(), revokeReason = ? WHERE userId = ? AND tenantId = ? AND deviceId = ? AND revokedAt IS NULL',
        ['USER_REVOKED', req.auth.sub, req.auth.tenantId, deviceId]
    );

    if (updateResult.affectedRows === 0) {
        throw new AppError(404, 'TOKEN_NOT_FOUND', 'No active biometric credential found for this device.');
    }

    logger.info({ event: 'biometric-revoked', userId: req.auth.sub, deviceId, ip: req.ip }, 'Mobile biometric credential revoked by user');

    return res.status(204).send();
});
