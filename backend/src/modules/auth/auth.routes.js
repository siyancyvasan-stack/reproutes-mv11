import { Router } from 'express';
import { distributedRateLimit } from '../../middleware/distributedRateLimit.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { loginSchema, refreshSchema, requestPasswordResetSchema, resetPasswordSchema } from './auth.schema.js';
import * as controller from './auth.controller.js';
import { passkeyRouter } from './passkey.routes.js';
import { mobileBiometricRouter } from './mobile-biometric.routes.js';
import { env } from '../../config/env.js';
export const authRouter = Router();
const loginLimiter = distributedRateLimit('auth-login', {
    windowMs: 15 * 60_000,
    // Keep production strict while allowing local UI/auth testing without
    // repeatedly locking the developer out for fifteen minutes.
    limit: env.NODE_ENV === 'production' ? 5 : 100,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'LOGIN_RATE_LIMITED',
            message: 'Too many failed sign-in attempts. Please wait a few minutes and try again.',
        },
    },
});
const refreshLimiter = distributedRateLimit('auth-refresh', {
    windowMs: 15 * 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
const handoffLimiter = distributedRateLimit('auth-webview-handoff', { windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
authRouter.post('/login', loginLimiter, validate(loginSchema), controller.login);
authRouter.post('/password-reset/request', loginLimiter, validate(requestPasswordResetSchema), controller.requestPasswordReset);
authRouter.post('/password-reset/confirm', loginLimiter, validate(resetPasswordSchema), controller.resetPassword);
authRouter.post(['/register/request-otp', '/register/verify-otp'], (_req, res) => {
    res.status(403).json({
        error: {
            code: 'MANAGER_PROVISIONED_ACCOUNTS_ONLY',
            message: 'Sales accounts must be created by a Manager.',
        },
    });
});
authRouter.post('/refresh', refreshLimiter, validate(refreshSchema), controller.refresh);
authRouter.post('/logout', validate(refreshSchema), controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/webview-handoff', handoffLimiter, authenticate, controller.createWebViewHandoff);
authRouter.post('/webview-handoff/exchange', handoffLimiter, controller.exchangeWebViewHandoff);
authRouter.use('/passkey', passkeyRouter);
authRouter.use('/mobile-biometric', mobileBiometricRouter);
