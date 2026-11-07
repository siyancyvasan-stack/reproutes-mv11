import { Router } from 'express';
import { distributedRateLimit } from '../../middleware/distributedRateLimit.js';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, } from '@simplewebauthn/server';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';
import db from '../../lib/db.js';
import { createAuthenticatedSession } from './auth.service.js';
import { randomUUID } from 'node:crypto';

export const passkeyRouter = Router();
const CHALLENGE_TTL_MS = 5 * 60_000;
const passkeyLimiter = distributedRateLimit('passkey', {
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many biometric attempts. Try again later.' } },
});
const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: env.JWT_REFRESH_TTL_DAYS * 86_400_000,
    path: '/api/v1/auth',
};

export const savePasskeyChallenge = async (challenge, purpose, userId = null) => {
    const id = randomUUID();
    await db.query(
        'INSERT INTO PasskeyChallenge (id, challenge, purpose, userId, expiresAt) VALUES (?, ?, ?, ?, ?)',
        [id, challenge, purpose, userId, new Date(Date.now() + CHALLENGE_TTL_MS)]
    );
    return { id };
};

export const consumePasskeyChallenge = async (flowId, purpose, userId = null) => {
    const [challenges] = await db.query(
        'SELECT * FROM PasskeyChallenge WHERE id = ? AND purpose = ? AND consumedAt IS NULL AND expiresAt > NOW()' + (userId ? ' AND userId = ?' : ''),
        userId ? [flowId, purpose, userId] : [flowId, purpose]
    );
    const challenge = challenges[0];
    if (!challenge)
        throw new AppError(400, 'CHALLENGE_EXPIRED', 'Biometric request expired. Please try again.');
    const [consumed] = await db.query(
        'UPDATE PasskeyChallenge SET consumedAt = NOW() WHERE id = ? AND consumedAt IS NULL',
        [challenge.id]
    );
    if (consumed.affectedRows !== 1)
        throw new AppError(400, 'CHALLENGE_USED', 'Biometric request was already used.');
    return challenge.challenge;
};

passkeyRouter.post('/register/options', authenticate, async (req, res) => {
    const [users] = await db.query('SELECT id, status, email, name FROM User WHERE id = ?', [req.auth.sub]);
    const user = users[0];
    if (!user || user.status !== 'ACTIVE')
        throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active.');
        
    const [credentials] = await db.query('SELECT credentialId, transports FROM BiometricCredential WHERE userId = ? AND revokedAt IS NULL', [user.id]);
    
    const options = await generateRegistrationOptions({
        rpName: env.WEBAUTHN_RP_NAME,
        rpID: env.WEBAUTHN_RP_ID,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        userDisplayName: user.name,
        timeout: 60_000,
        attestationType: 'none',
        excludeCredentials: credentials.map((credential) => ({
            id: credential.credentialId,
            transports: typeof credential.transports === 'string' ? JSON.parse(credential.transports) : (credential.transports ?? []),
        })),
        authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'required',
            userVerification: 'required',
        },
    });
    const flow = await savePasskeyChallenge(options.challenge, 'REGISTER', user.id);
    res.json({ flowId: flow.id, options });
});

passkeyRouter.post('/register/verify', authenticate, async (req, res) => {
    const input = z.object({
        flowId: z.string().min(1),
        deviceName: z.string().trim().min(1).max(100),
        response: z.custom(),
    }).parse(req.body);
    const expectedChallenge = await consumePasskeyChallenge(input.flowId, 'REGISTER', req.auth.sub);
    const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge,
        expectedOrigin: env.WEBAUTHN_ORIGIN,
        expectedRPID: env.WEBAUTHN_RP_ID,
        requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
        throw new AppError(401, 'BIOMETRIC_NOT_RECOGNIZED', 'Biometric verification failed.');
    }
    const { credential, credentialDeviceType } = verification.registrationInfo;
    const credentialIdStr = credential.id;
    const publicKey = Buffer.from(credential.publicKey);
    const savedId = randomUUID();
    const transports = JSON.stringify(input.response.response.transports ?? []);
    
    await db.query(
        'INSERT INTO BiometricCredential (id, userId, credentialId, publicKey, signCount, deviceName, credentialType, transports) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [savedId, req.auth.sub, credentialIdStr, publicKey, BigInt(credential.counter), input.deviceName, credentialDeviceType, transports]
    );
    await db.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
        [req.auth.tenantId, req.auth.sub, 'PASSKEY_REGISTERED', 'BiometricCredential', savedId, req.ip]
    );
    res.status(201).json({ verified: true, credentialId: credentialIdStr });
});

passkeyRouter.post('/login/options', passkeyLimiter, async (_req, res) => {
    const options = await generateAuthenticationOptions({
        rpID: env.WEBAUTHN_RP_ID,
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: [],
    });
    const flow = await savePasskeyChallenge(options.challenge, 'LOGIN');
    res.json({ flowId: flow.id, options });
});

passkeyRouter.post('/login/verify', passkeyLimiter, async (req, res) => {
    const input = z.object({
        flowId: z.string().min(1),
        response: z.custom(),
    }).parse(req.body);
    const expectedChallenge = await consumePasskeyChallenge(input.flowId, 'LOGIN');
    
    const [credentials] = await db.query(
        'SELECT b.*, u.id as u_id, u.tenantId as u_tenantId, u.role as u_role, u.email as u_email, u.status as u_status, u.name as u_name FROM BiometricCredential b JOIN User u ON b.userId = u.id WHERE b.credentialId = ? LIMIT 1',
        [input.response.id]
    );
    const credential = credentials[0];
    
    if (!credential || credential.revokedAt || credential.u_status !== 'ACTIVE') {
        throw new AppError(401, 'CREDENTIAL_REVOKED', 'This biometric credential is unavailable or revoked.');
    }
    
    const user = { id: credential.u_id, tenantId: credential.u_tenantId, role: credential.u_role, email: credential.u_email, status: credential.u_status, name: credential.u_name };
    
    try {
        const verification = await verifyAuthenticationResponse({
            response: input.response,
            expectedChallenge,
            expectedOrigin: env.WEBAUTHN_ORIGIN,
            expectedRPID: env.WEBAUTHN_RP_ID,
            requireUserVerification: true,
            credential: {
                id: credential.credentialId,
                publicKey: new Uint8Array(credential.publicKey),
                counter: Number(credential.signCount),
                transports: typeof credential.transports === 'string' ? JSON.parse(credential.transports) : (credential.transports ?? []),
            },
        });
        if (!verification.verified)
            throw new Error('Assertion was not verified');
            
        await db.query(
            'UPDATE BiometricCredential SET signCount = ?, lastUsedAt = NOW() WHERE id = ?',
            [BigInt(verification.authenticationInfo.newCounter), credential.id]
        );
        
        const session = await createAuthenticatedSession(user, { ip: req.ip, userAgent: req.headers['user-agent'] }, 'PASSKEY_LOGIN', credential.id);
        res.cookie('tf_refresh', session.refreshToken, cookieOptions);
        return res.json({ accessToken: session.accessToken, user: session.user });
    }
    catch (error) {
        await db.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [user.tenantId, user.id, 'PASSKEY_LOGIN_FAILED', 'BiometricCredential', credential.id, req.ip]
        );
        if (error instanceof AppError)
            throw error;
        throw new AppError(401, 'BIOMETRIC_NOT_RECOGNIZED', 'Fingerprint or device verification was not recognized.');
    }
});

passkeyRouter.get('/devices', authenticate, async (req, res) => {
    const [devices] = await db.query(
        'SELECT credentialId, deviceName, credentialType, transports, createdAt, lastUsedAt FROM BiometricCredential WHERE userId = ? AND revokedAt IS NULL ORDER BY createdAt DESC',
        [req.auth.sub]
    );
    res.json(devices.map(d => ({
        ...d,
        transports: typeof d.transports === 'string' ? JSON.parse(d.transports) : d.transports
    })));
});

passkeyRouter.delete('/devices/:credentialId', authenticate, async (req, res) => {
    const [credentials] = await db.query(
        'SELECT id FROM BiometricCredential WHERE credentialId = ? AND userId = ? AND revokedAt IS NULL LIMIT 1',
        [String(req.params.credentialId), req.auth.sub]
    );
    const credential = credentials[0];
    if (!credential)
        throw new AppError(404, 'CREDENTIAL_NOT_FOUND', 'Registered device was not found.');
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        await connection.query('UPDATE BiometricCredential SET revokedAt = NOW() WHERE id = ?', [credential.id]);
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
            [req.auth.tenantId, req.auth.sub, 'PASSKEY_REMOVED', 'BiometricCredential', credential.id, req.ip]
        );
        await connection.query('UPDATE RefreshToken SET revokedAt = NOW() WHERE passkeyCredentialId = ? AND revokedAt IS NULL', [credential.id]);
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    res.status(204).send();
});
