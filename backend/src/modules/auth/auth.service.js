import db from '../../lib/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { verifyPassword } from '../../lib/password.js';
import { createRefreshToken, hashToken, signAccessToken } from '../../lib/jwt.js';
import { env } from '../../config/env.js';
import { createHmac, randomInt } from 'node:crypto';
import { hashPassword } from '../../lib/password.js';
import { sendRegistrationOtp } from '../../lib/email.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';

export const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.toLowerCase(),
    avatar: user.avatarUrl ?? '',
    employeeCode: user.employeeCode ?? '',
    phone: user.phone ?? undefined,
    region: user.region ?? undefined,
});

export const createAuthenticatedSession = async (user, context, action = 'LOGIN', passkeyCredentialId = null) => {
    const refreshToken = createRefreshToken();
    const tokenHash = hashToken(refreshToken);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query(
            'INSERT INTO RefreshToken (id, userId, tokenHash, expiresAt, familyId, clientType, ipAddress, userAgent, passkeyCredentialId) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)',
            [user.id, tokenHash, expiresAt, familyId, context.clientType ?? 'WEB', context.ip, context.userAgent, passkeyCredentialId]
        );
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [user.tenantId, user.id, action, 'User', user.id, context.ip]
        );
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }

    return {
        accessToken: signAccessToken({
            sub: user.id,
            tenantId: user.tenantId,
            role: user.role,
            email: user.email,
        }),
        refreshToken,
        user: publicUser(user),
    };
};

const otpHash = (email, code) => createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${email}:${code}`).digest('hex');

export const requestRegistrationOtp = async (input) => {
    const [tenants] = await db.query('SELECT id FROM Tenant WHERE slug = ?', [input.tenant]);
    if (tenants.length === 0) throw new AppError(404, 'TENANT_NOT_FOUND', 'Company workspace was not found');
    const tenant = tenants[0];

    const [existingUsers] = await db.query('SELECT id FROM User WHERE tenantId = ? AND email = ?', [tenant.id, input.email]);
    if (existingUsers.length > 0) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email');

    const code = String(randomInt(100_000, 1_000_000));
    const passwordHash = await hashPassword(input.password);

    await db.query(
        'UPDATE EmailVerification SET consumedAt = NOW() WHERE email = ? AND tenantSlug = ? AND purpose = ? AND consumedAt IS NULL',
        [input.email, input.tenant, 'REGISTER']
    );

    const payload = JSON.stringify({ name: input.name, passwordHash });
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);
    const verificationId = randomUUID();

    await db.query(
        'INSERT INTO EmailVerification (id, email, tenantSlug, purpose, codeHash, payload, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [verificationId, input.email, input.tenant, 'REGISTER', otpHash(input.email, code), payload, expiresAt]
    );

    try {
        await sendRegistrationOtp(input.email, input.name, code);
    } catch (error) {
        await db.query('DELETE FROM EmailVerification WHERE id = ?', [verificationId]).catch(() => undefined);
        throw error;
    }
};

export const verifyRegistrationOtp = async (input) => {
    const [verifications] = await db.query(
        'SELECT * FROM EmailVerification WHERE email = ? AND tenantSlug = ? AND purpose = ? AND consumedAt IS NULL ORDER BY createdAt DESC LIMIT 1',
        [input.email, input.tenant, 'REGISTER']
    );
    const verification = verifications[0];

    if (!verification || new Date(verification.expiresAt) <= new Date()) {
        throw new AppError(400, 'OTP_EXPIRED', 'Verification code is invalid or expired');
    }
    if (verification.attempts >= 5) {
        throw new AppError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new code.');
    }
    if (verification.codeHash !== otpHash(input.email, input.code)) {
        await db.query('UPDATE EmailVerification SET attempts = attempts + 1 WHERE id = ?', [verification.id]);
        throw new AppError(400, 'OTP_INVALID', 'Verification code is incorrect');
    }

    const [tenants] = await db.query('SELECT id FROM Tenant WHERE slug = ?', [input.tenant]);
    if (tenants.length === 0) throw new AppError(404, 'TENANT_NOT_FOUND', 'Company workspace was not found');
    const tenant = tenants[0];

    const payload = typeof verification.payload === 'string' ? JSON.parse(verification.payload) : verification.payload;

    const connection = await db.getConnection();
    await connection.beginTransaction();
    let createdUser;
    try {
        const userId = randomUUID();
        await connection.query(
            'INSERT INTO User (id, tenantId, email, passwordHash, name, role) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, tenant.id, input.email, payload.passwordHash, payload.name, 'AGENT']
        );
        
        await connection.query(
            'INSERT INTO AgentProfile (id, userId, status) VALUES (?, ?)',
            [userId, 'OFFLINE']
        );

        await connection.query('UPDATE EmailVerification SET consumedAt = NOW() WHERE id = ?', [verification.id]);

        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId) VALUES (?, ?, ?, ?, ?)',
            [tenant.id, userId, 'REGISTER_EMAIL_VERIFIED', 'User', userId]
        );

        const [users] = await connection.query('SELECT * FROM User WHERE id = ?', [userId]);
        createdUser = users[0];
        
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email');
        }
        throw error;
    } finally {
        connection.release();
    }

    return publicUser(createdUser);
};

export const login = async (input, context) => {
    const loginEmail = resolveLoginEmail(input.email, input.tenant);
    const [users] = await db.query(
        'SELECT u.* FROM User u JOIN Tenant t ON u.tenantId = t.id WHERE u.email = ? AND t.slug = ? AND u.status = ? LIMIT 1',
        [loginEmail, input.tenant, 'ACTIVE']
    );
    const user = users[0];

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        logger.warn({ event: 'login-failed', email: input.email, tenant: input.tenant, ip: context.ip, userAgent: context.userAgent }, 'Login failed');
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return createAuthenticatedSession(user, context);
};

export const resolveLoginEmail = (email, tenant) => email;

export const refresh = async (token, context) => {
    const [storedTokens] = await db.query(
        'SELECT r.*, u.tenantId, u.role, u.email, u.status as userStatus, u.id as userId, u.name, u.avatarUrl, u.employeeCode, u.phone, u.region FROM RefreshToken r JOIN User u ON r.userId = u.id WHERE r.tokenHash = ? LIMIT 1',
        [hashToken(token)]
    );
    const stored = storedTokens[0];

    if (stored?.revokedAt && stored.replacedByHash) {
        const detectedAt = new Date();
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            await connection.query(
                'UPDATE RefreshToken SET revokedAt = ?, reuseDetectedAt = ? WHERE familyId = ? AND revokedAt IS NULL',
                [detectedAt, detectedAt, stored.familyId]
            );
            await connection.query('UPDATE RefreshToken SET reuseDetectedAt = ? WHERE id = ?', [detectedAt, stored.id]);
            await connection.commit();
        } catch (err) {
            await connection.rollback();
        } finally {
            connection.release();
        }
        logger.warn({ event: 'refresh-token-reuse', userId: stored.userId, familyId: stored.familyId, ip: context.ip }, 'Refresh token reuse detected');
        throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse was detected');
    }

    if (!stored || stored.revokedAt || new Date(stored.expiresAt) <= new Date() || stored.userStatus !== 'ACTIVE' || stored.clientType !== context.clientType) {
        logger.warn({ event: 'refresh-failed', reason: 'invalid-or-expired', ip: context.ip }, 'Refresh failed');
        throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    }

    const nextToken = createRefreshToken();
    const nextHash = hashToken(nextToken);
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const [updateResult] = await connection.query(
            'UPDATE RefreshToken SET revokedAt = NOW(), replacedByHash = ? WHERE id = ? AND revokedAt IS NULL',
            [nextHash, stored.id]
        );
        
        if (updateResult.affectedRows !== 1) {
            throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token was already used');
        }

        await connection.query(
            'INSERT INTO RefreshToken (id, userId, tokenHash, expiresAt, familyId, clientType, ipAddress, userAgent, passkeyCredentialId) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)',
            [stored.userId, nextHash, expiresAt, stored.familyId, stored.clientType, context.ip, context.userAgent, stored.passkeyCredentialId]
        );
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }

    return {
        accessToken: signAccessToken({
            sub: stored.userId,
            tenantId: stored.tenantId,
            role: stored.role,
            email: stored.email,
        }),
        refreshToken: nextToken,
        user: publicUser({ id: stored.userId, email: stored.email, name: stored.name, role: stored.role, avatarUrl: stored.avatarUrl, employeeCode: stored.employeeCode, phone: stored.phone, region: stored.region }),
    };
};

export const logout = async (token) => {
    if (token) {
        await db.query('UPDATE RefreshToken SET revokedAt = NOW() WHERE tokenHash = ? AND revokedAt IS NULL', [hashToken(token)]);
    }
};
