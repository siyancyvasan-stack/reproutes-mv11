import { Role } from '../../lib/enums.js';
import { Router } from 'express';
import { z } from 'zod';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { randomUUID } from 'node:crypto';

export const settingsRouter = Router();
settingsRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid 24-hour time');
const day = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const settingsInput = z.object({
    gpsTrackingEnabled: z.boolean(),
    gpsUpdateIntervalSeconds: z.coerce.number().int().min(5).max(300),
    gpsAccuracyThresholdMeters: z.coerce.number().int().min(5).max(500),
    attendanceRequireGps: z.boolean(),
    attendanceLateGraceMinutes: z.coerce.number().int().min(0).max(120),
    attendanceAllowManualEdits: z.boolean(),
    workingStart: time,
    workingEnd: time,
    timezone: z.enum(['Asia/Colombo', 'UTC']),
    workingDays: z.array(day).min(1),
    geofenceEnabled: z.boolean(),
    geofenceRadiusMeters: z.coerce.number().int().min(25).max(5000),
    geofenceBlockOutside: z.boolean(),
    commissionEnabled: z.boolean(),
    commissionRatePercent: z.coerce.number().min(0).max(100),
    commissionMinimumRevenueLkr: z.coerce.number().min(0).max(1_000_000_000),
    sessionTimeoutMinutes: z.coerce.number().int().min(15).max(10_080),
    requirePasskeyForManagers: z.boolean(),
    notifyLateArrival: z.boolean(),
    notifyGeofenceViolation: z.boolean(),
    notifyDailySummary: z.boolean(),
    emailNotificationsEnabled: z.boolean(),
    mapProvider: z.enum(['OPENSTREETMAP', 'GOOGLE_MAPS']),
    routingProvider: z.enum(['OSRM', 'GOOGLE_DIRECTIONS']),
    webhookEnabled: z.boolean(),
    webhookUrl: z.union([z.literal(''), z.string().url().refine((value) => value.startsWith('https://'), 'Webhook URL must use HTTPS')]),
}).strict().superRefine((value, context) => {
    if (value.workingStart === value.workingEnd) {
        context.addIssue({ code: 'custom', path: ['workingEnd'], message: 'Shift end must differ from shift start' });
    }
    if (value.webhookEnabled && !value.webhookUrl) {
        context.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'Webhook URL is required when webhooks are enabled' });
    }
});

const defaults = {
    gpsTrackingEnabled: true,
    gpsUpdateIntervalSeconds: 30,
    gpsAccuracyThresholdMeters: 100,
    attendanceRequireGps: true,
    attendanceLateGraceMinutes: 15,
    attendanceAllowManualEdits: false,
    workingStart: '08:00',
    workingEnd: '17:00',
    timezone: 'Asia/Colombo',
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    geofenceEnabled: true,
    geofenceRadiusMeters: 100,
    geofenceBlockOutside: true,
    commissionEnabled: true,
    commissionRatePercent: 2.5,
    commissionMinimumRevenueLkr: 0,
    sessionTimeoutMinutes: 480,
    requirePasskeyForManagers: false,
    notifyLateArrival: true,
    notifyGeofenceViolation: true,
    notifyDailySummary: true,
    emailNotificationsEnabled: true,
    mapProvider: 'OPENSTREETMAP',
    routingProvider: 'OSRM',
    webhookEnabled: false,
    webhookUrl: '',
};

const serialize = (settings) => ({
    ...defaults,
    ...settings,
    commissionRatePercent: Number(settings.commissionRatePercent),
    commissionMinimumRevenueLkr: Number(settings.commissionMinimumRevenueLkr),
    webhookUrl: settings.webhookUrl ?? '',
    workingDays: typeof settings.workingDays === 'string' ? JSON.parse(settings.workingDays) : (settings.workingDays ?? defaults.workingDays)
});

settingsRouter.get('/', async (req, res) => {
    const [settingsRows] = await db.query('SELECT * FROM TenantSettings WHERE tenantId = ?', [req.auth.tenantId]);
    const settings = settingsRows[0];
    res.json(settings ? serialize(settings) : defaults);
});

settingsRouter.put('/', async (req, res) => {
    const input = settingsInput.parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const webhookUrl = input.webhookEnabled ? input.webhookUrl : null;
    const workingDays = JSON.stringify(input.workingDays);
    const updatedById = req.auth.sub;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        await connection.query(`
            INSERT INTO TenantSettings (
                tenantId, gpsTrackingEnabled, gpsUpdateIntervalSeconds, gpsAccuracyThresholdMeters,
                attendanceRequireGps, attendanceLateGraceMinutes, attendanceAllowManualEdits,
                workingStart, workingEnd, timezone, workingDays, geofenceEnabled, geofenceRadiusMeters,
                geofenceBlockOutside, commissionEnabled, commissionRatePercent, commissionMinimumRevenueLkr,
                sessionTimeoutMinutes, requirePasskeyForManagers, notifyLateArrival, notifyGeofenceViolation,
                notifyDailySummary, emailNotificationsEnabled, mapProvider, routingProvider, webhookEnabled,
                webhookUrl, updatedById, updatedAt
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, NOW()
            ) ON DUPLICATE KEY UPDATE
                gpsTrackingEnabled = VALUES(gpsTrackingEnabled),
                gpsUpdateIntervalSeconds = VALUES(gpsUpdateIntervalSeconds),
                gpsAccuracyThresholdMeters = VALUES(gpsAccuracyThresholdMeters),
                attendanceRequireGps = VALUES(attendanceRequireGps),
                attendanceLateGraceMinutes = VALUES(attendanceLateGraceMinutes),
                attendanceAllowManualEdits = VALUES(attendanceAllowManualEdits),
                workingStart = VALUES(workingStart),
                workingEnd = VALUES(workingEnd),
                timezone = VALUES(timezone),
                workingDays = VALUES(workingDays),
                geofenceEnabled = VALUES(geofenceEnabled),
                geofenceRadiusMeters = VALUES(geofenceRadiusMeters),
                geofenceBlockOutside = VALUES(geofenceBlockOutside),
                commissionEnabled = VALUES(commissionEnabled),
                commissionRatePercent = VALUES(commissionRatePercent),
                commissionMinimumRevenueLkr = VALUES(commissionMinimumRevenueLkr),
                sessionTimeoutMinutes = VALUES(sessionTimeoutMinutes),
                requirePasskeyForManagers = VALUES(requirePasskeyForManagers),
                notifyLateArrival = VALUES(notifyLateArrival),
                notifyGeofenceViolation = VALUES(notifyGeofenceViolation),
                notifyDailySummary = VALUES(notifyDailySummary),
                emailNotificationsEnabled = VALUES(emailNotificationsEnabled),
                mapProvider = VALUES(mapProvider),
                routingProvider = VALUES(routingProvider),
                webhookEnabled = VALUES(webhookEnabled),
                webhookUrl = VALUES(webhookUrl),
                updatedById = VALUES(updatedById),
                updatedAt = VALUES(updatedAt)
        `, [
            tenantId, input.gpsTrackingEnabled, input.gpsUpdateIntervalSeconds, input.gpsAccuracyThresholdMeters,
            input.attendanceRequireGps, input.attendanceLateGraceMinutes, input.attendanceAllowManualEdits,
            input.workingStart, input.workingEnd, input.timezone, workingDays, input.geofenceEnabled, input.geofenceRadiusMeters,
            input.geofenceBlockOutside, input.commissionEnabled, input.commissionRatePercent, input.commissionMinimumRevenueLkr,
            input.sessionTimeoutMinutes, input.requirePasskeyForManagers, input.notifyLateArrival, input.notifyGeofenceViolation,
            input.notifyDailySummary, input.emailNotificationsEnabled, input.mapProvider, input.routingProvider, input.webhookEnabled,
            webhookUrl, updatedById
        ]);
        
        await connection.query(
            'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, ipAddress) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                tenantId, req.auth.sub, 'TENANT_SETTINGS_UPDATED', 'TenantSettings', tenantId,
                JSON.stringify({
                    gpsTrackingEnabled: input.gpsTrackingEnabled,
                    attendanceRequireGps: input.attendanceRequireGps,
                    geofenceEnabled: input.geofenceEnabled,
                    commissionEnabled: input.commissionEnabled,
                    mapProvider: input.mapProvider,
                    routingProvider: input.routingProvider,
                    webhookEnabled: input.webhookEnabled,
                }),
                req.ip
            ]
        );
        
        const [resQuery] = await connection.query('SELECT * FROM TenantSettings WHERE tenantId = ?', [tenantId]);
        updated = resQuery[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    res.json(serialize(updated));
});
