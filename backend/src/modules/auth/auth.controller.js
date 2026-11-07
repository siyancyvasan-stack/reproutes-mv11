import * as authService from './auth.service.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createDeviceSession, closeDeviceSessions, touchDeviceSession, } from '../../lib/deviceSession.js';
import { createRefreshToken, hashToken } from '../../lib/jwt.js';
import db from '../../lib/db.js';
import { hashPassword } from '../../lib/password.js';
import { sendPasswordReset } from '../../lib/email.js';
import { randomUUID } from 'node:crypto';
const WEBVIEW_HANDOFF_TTL_MS = 60_000;
const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: env.JWT_REFRESH_TTL_DAYS * 86_400_000,
    path: '/api/v1/auth',
};
const clientType = (req) => String(req.headers['x-client-platform']).toLowerCase() === 'mobile' ? 'MOBILE' : 'WEB';
const assertTrustedCookieOrigin = (req, client) => {
    if (client === 'MOBILE' || !req.cookies.tf_refresh)
        return;
    const origin = req.get('origin');
    if (origin && !env.CORS_ORIGINS.includes(origin)) {
        throw new AppError(403, 'UNTRUSTED_ORIGIN', 'Request origin is not allowed');
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
        throw new AppError(403, 'CSRF_REJECTED', 'Cross-site session request rejected');
    }
};
export const login = async (req, res) => {
    const client = clientType(req);
    const result = await authService.login(req.body, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        clientType: client,
    });
    // Record device session — fire and forget, never blocks login
    // Decode tenantId from the access token since publicUser() strips it
    try {
        const { verifyAccessToken } = await import('../../lib/jwt.js');
        const claims = verifyAccessToken(result.accessToken);
        void createDeviceSession({
            tenantId: claims.tenantId,
            userId: claims.sub,
            userAgent: req.headers['user-agent'],
            clientPlatform: req.headers['x-client-platform'],
            appVersion: req.headers['x-app-version'],
            ip: req.ip,
        });
    }
    catch {
        // non-blocking — if JWT parse fails here, login still succeeds
    }
    if (client === 'WEB')
        res.cookie('tf_refresh', result.refreshToken, cookieOptions);
    return res.json({ accessToken: result.accessToken, refreshToken: client === 'MOBILE' ? result.refreshToken : undefined, user: result.user });
};
export const requestRegistrationOtp = async (req, res) => {
    await authService.requestRegistrationOtp(req.body);
    return res.status(202).json({
        message: 'If the address can be registered, a verification code has been sent.',
        expiresInMinutes: env.OTP_TTL_MINUTES,
    });
};
export const verifyRegistrationOtp = async (req, res) => {
    const user = await authService.verifyRegistrationOtp(req.body);
    return res.status(201).json({ message: 'Account verified successfully', user });
};
export const requestPasswordReset = async (req, res) => {
    const { email, tenant } = req.body;
    // The response is deliberately identical whether or not the account exists.
    const [users] = await db.query(
        'SELECT u.id, u.name, u.email FROM User u JOIN Tenant t ON t.id = u.tenantId WHERE u.email = ? AND t.slug = ? AND u.status = ? LIMIT 1',
        [email, tenant, 'ACTIVE']
    );
    const user = users[0];
    if (user) {
        const token = createRefreshToken();
        const expiresAt = new Date(Date.now() + 15 * 60_000);
        await db.query('UPDATE EmailVerification SET consumedAt = NOW() WHERE email = ? AND tenantSlug = ? AND purpose = ? AND consumedAt IS NULL', [email, tenant, 'PASSWORD_RESET']);
        await db.query(
            'INSERT INTO EmailVerification (id, email, tenantSlug, purpose, codeHash, payload, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [randomUUID(), email, tenant, 'PASSWORD_RESET', hashToken(token), JSON.stringify({ userId: user.id }), expiresAt]
        );
        const resetUrl = new URL(env.WEBAUTHN_ORIGIN);
        resetUrl.searchParams.set('reset', token);
        resetUrl.searchParams.set('email', email);
        try {
            await sendPasswordReset(email, user.name, resetUrl.toString());
        } catch (error) {
            await db.query('UPDATE EmailVerification SET consumedAt = NOW() WHERE email = ? AND tenantSlug = ? AND purpose = ? AND codeHash = ?', [email, tenant, 'PASSWORD_RESET', hashToken(token)]).catch(() => undefined);
            throw error;
        }
    }
    return res.status(202).json({ message: 'If the account exists, a password reset link has been sent.' });
};
export const resetPassword = async (req, res) => {
    const { email, tenant, token, password } = req.body;
    const [resets] = await db.query(
        'SELECT * FROM EmailVerification WHERE email = ? AND tenantSlug = ? AND purpose = ? AND codeHash = ? AND consumedAt IS NULL AND expiresAt > NOW() ORDER BY createdAt DESC LIMIT 1',
        [email, tenant, 'PASSWORD_RESET', hashToken(token)]
    );
    const reset = resets[0];
    if (!reset) throw new AppError(400, 'PASSWORD_RESET_INVALID', 'This password reset link is invalid or expired.');
    const [users] = await db.query('SELECT u.id, u.tenantId FROM User u JOIN Tenant t ON t.id = u.tenantId WHERE u.email = ? AND t.slug = ? AND u.status = ? LIMIT 1', [email, tenant, 'ACTIVE']);
    const user = users[0];
    if (!user) throw new AppError(400, 'PASSWORD_RESET_INVALID', 'This password reset link is invalid or expired.');
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const [consumed] = await connection.query('UPDATE EmailVerification SET consumedAt = NOW() WHERE id = ? AND consumedAt IS NULL', [reset.id]);
        if (consumed.affectedRows !== 1) throw new AppError(400, 'PASSWORD_RESET_INVALID', 'This password reset link has already been used.');
        await connection.query('UPDATE User SET passwordHash = ? WHERE id = ?', [await hashPassword(password), user.id]);
        await connection.query('UPDATE RefreshToken SET revokedAt = NOW() WHERE userId = ? AND revokedAt IS NULL', [user.id]);
        await connection.query('INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)', [user.tenantId, user.id, 'PASSWORD_RESET', 'User', user.id, req.ip]);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }
    return res.status(204).send();
};
export const refresh = async (req, res) => {
    const client = clientType(req);
    assertTrustedCookieOrigin(req, client);
    const refreshToken = client === 'MOBILE' ? req.body?.refreshToken : req.cookies.tf_refresh ?? req.body?.refreshToken;
    if (!refreshToken) {
        throw new AppError(401, 'REFRESH_TOKEN_REQUIRED', 'Refresh token is required');
    }
    const result = await authService.refresh(refreshToken, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        clientType: client,
    });
    if (client === 'WEB')
        res.cookie('tf_refresh', result.refreshToken, cookieOptions);
    return res.json({ accessToken: result.accessToken, refreshToken: client === 'MOBILE' ? result.refreshToken : undefined, user: result.user });
};
export const logout = async (req, res) => {
    const client = clientType(req);
    assertTrustedCookieOrigin(req, client);
    const refreshToken = client === 'MOBILE' ? req.body?.refreshToken : req.cookies.tf_refresh ?? req.body?.refreshToken;
    await authService.logout(refreshToken);
    // Close device sessions — fire and forget
    if (req.auth?.sub)
        void closeDeviceSessions(req.auth.sub);
    if (client === 'WEB') {
        res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
        res.clearCookie('tf_refresh', cookieOptions);
    }
    return res.status(204).send();
};
export const me = async (req, res) => {
    const [users] = await db.query(
        'SELECT id, email, name, role, avatarUrl, employeeCode, phone, region, tenantId FROM User WHERE id = ?',
        [req.auth.sub]
    );
    const user = users[0];
    // Touch session heartbeat — fire and forget
    if (req.auth?.sub && req.auth?.tenantId) {
        void touchDeviceSession(req.auth.sub, req.auth.tenantId, req.headers['x-app-version']);
    }
    return res.json({ user });
};
export const createWebViewHandoff = async (req, res) => {
    const code = createRefreshToken();
    await db.query(
        'INSERT INTO PasskeyChallenge (id, userId, challenge, purpose, expiresAt) VALUES (?, ?, ?, ?)',
        [req.auth.sub, hashToken(code), 'WEBVIEW_HANDOFF', new Date(Date.now() + WEBVIEW_HANDOFF_TTL_MS)]
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ code, expiresInSeconds: WEBVIEW_HANDOFF_TTL_MS / 1000 });
};
export const exchangeWebViewHandoff = async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (code.length < 32)
        throw new AppError(400, 'HANDOFF_INVALID', 'Mobile session handoff is invalid');
    const [handoffs] = await db.query(
        'SELECT p.*, u.id as userId, u.email as userEmail, u.name as userName, u.role as userRole, u.tenantId as userTenantId, u.status as userStatus FROM PasskeyChallenge p JOIN User u ON p.userId = u.id WHERE p.challenge = ? AND p.purpose = ? AND p.consumedAt IS NULL AND p.expiresAt > NOW() LIMIT 1',
        [hashToken(code), 'WEBVIEW_HANDOFF']
    );
    const handoff = handoffs[0];
    if (handoff) {
        handoff.user = { id: handoff.userId, email: handoff.userEmail, name: handoff.userName, role: handoff.userRole, tenantId: handoff.userTenantId, status: handoff.userStatus };
    }
    if (!handoff?.user || handoff.user.status !== 'ACTIVE') {
        throw new AppError(400, 'HANDOFF_EXPIRED', 'Mobile session handoff expired. Return to the app and try again.');
    }
    const [updateResult] = await db.query(
        'UPDATE PasskeyChallenge SET consumedAt = NOW() WHERE id = ? AND consumedAt IS NULL',
        [handoff.id]
    );
    if (updateResult.affectedRows !== 1)
        throw new AppError(409, 'HANDOFF_USED', 'Mobile session handoff was already used');
    const session = await authService.createAuthenticatedSession(handoff.user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        clientType: 'WEB',
    });
    res.cookie('tf_refresh', session.refreshToken, cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ accessToken: session.accessToken, user: session.user });
};
