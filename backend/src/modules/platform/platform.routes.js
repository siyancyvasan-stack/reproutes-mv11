import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
export const platformRouter = Router();
platformRouter.use(authenticate);
platformRouter.get('/capabilities', (req, res) => {
    res.json({
        apiVersion: 'v1',
        tenantId: req.auth.tenantId,
        role: req.auth.role,
        transport: { rest: true, socketIo: true },
        authentication: { accessToken: 'jwt', refreshToken: 'httpOnly-cookie', biometrics: 'device-bound-passkey' },
        modules: {
            attendance: { offlineQueue: true },
            tracking: { offlineQueue: true, clientIdField: 'clientPointId', batchUpload: true },
            orders: { offlineQueue: false },
            fuel: { offlineQueue: false, receiptUpload: true, qrAuthorization: true },
            notifications: { realtime: true },
            files: { multipart: true, maximumBytes: 5_242_880 },
        },
        serverTime: new Date().toISOString(),
    });
});
