import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FuelAnomalyStatus, FuelClaimStatus, FuelGpsStatus, FuelQrStatus, FuelType, Role } from '../../lib/enums.js';
import { Router } from 'express';
import { z } from 'zod';
import db from '../../lib/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { createFileAsset, toStoredUpload } from '../files/file.service.js';
import { redirectToSignedObject } from '../files/object-storage.service.js';

export const fuelRouter = Router();
fuelRouter.use(authenticate);

const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const utcDay = (value = new Date()) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const audit = async (tenantId, actorId, action, entityId, metadata = null) => {
    await db.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [tenantId, actorId, action, 'FuelEntry', entityId, metadata ? JSON.stringify(metadata) : null]
    );
};

const emit = (req, event, payload) => req.app.get('io')?.to(`tenant:${req.auth.tenantId}`).emit(event, payload);

const haversine = (aLat, aLng, bLat, bLng) => {
    const radius = 6_371_000;
    const rad = (value) => (value * Math.PI) / 180;
    const dLat = rad(bLat - aLat);
    const dLng = rad(bLng - aLng);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(value));
};

fuelRouter.get('/vehicles', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    let q = 'SELECT v.*, u.id as u_id, u.name as u_name FROM Vehicle v LEFT JOIN User u ON v.assignedToId = u.id WHERE v.tenantId = ? AND v.active = ?';
    const params = [req.auth.tenantId, true];
    
    if (req.auth.role === Role.AGENT) {
        q += ' AND (v.assignedToId = ? OR v.assignedToId IS NULL)';
        params.push(req.auth.sub);
    }
    q += ' ORDER BY v.vehicleNumber ASC';
    
    const [rows] = await db.query(q, params);
    const vehicles = rows.map(r => ({
        ...r,
        assignedTo: r.u_id ? { id: r.u_id, name: r.u_name } : null
    }));
    res.json(vehicles);
});

fuelRouter.post('/vehicles', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const input = z.object({
        vehicleNumber: z.string().min(2), vehicleType: z.string().min(2), fuelType: z.nativeEnum(FuelType),
        tankCapacity: z.coerce.number().positive(), expectedKmL: z.coerce.number().positive(),
        minimumKmL: z.coerce.number().positive(), maximumKmL: z.coerce.number().positive(),
        currentOdometer: z.coerce.number().nonnegative(), assignedToId: z.string().optional(),
    }).parse(req.body);
    
    const id = randomUUID();
    await db.query(
        'INSERT INTO Vehicle (id, tenantId, vehicleNumber, vehicleType, fuelType, tankCapacity, expectedKmL, minimumKmL, maximumKmL, currentOdometer, assignedToId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, req.auth.tenantId, input.vehicleNumber.toUpperCase(), input.vehicleType, input.fuelType, input.tankCapacity, input.expectedKmL, input.minimumKmL, input.maximumKmL, input.currentOdometer, input.assignedToId || null, true]
    );
    
    const [rows] = await db.query('SELECT * FROM Vehicle WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
});

fuelRouter.get('/entries', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    
    const parsedStatus = z.nativeEnum(FuelClaimStatus).safeParse(req.query.status);
    const status = parsedStatus.success ? parsedStatus.data : undefined;
    const search = String(req.query.search ?? '').trim();
    const salespersonId = String(req.query.salespersonId ?? '').trim();
    const vehicleId = String(req.query.vehicleId ?? '').trim();
    const station = String(req.query.station ?? '').trim();
    const parsedFuelType = z.nativeEnum(FuelType).safeParse(req.query.fuelType);
    const fuelType = parsedFuelType.success ? parsedFuelType.data : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    
    let q = 'SELECT fe.*, v.id as v_id, v.vehicleNumber as v_num, u.id as u_id, u.name as u_name, u.avatarUrl as u_avatarUrl FROM FuelEntry fe JOIN Vehicle v ON fe.vehicleId = v.id JOIN User u ON fe.salespersonId = u.id WHERE fe.tenantId = ?';
    let countQ = 'SELECT COUNT(*) as c FROM FuelEntry fe JOIN Vehicle v ON fe.vehicleId = v.id JOIN User u ON fe.salespersonId = u.id WHERE fe.tenantId = ?';
    const params = [req.auth.tenantId];
    
    if (req.auth.role === Role.AGENT) {
        q += ' AND fe.salespersonId = ?'; countQ += ' AND fe.salespersonId = ?';
        params.push(req.auth.sub);
    } else if (salespersonId) {
        q += ' AND fe.salespersonId = ?'; countQ += ' AND fe.salespersonId = ?';
        params.push(salespersonId);
    }
    
    if (status) { q += ' AND fe.status = ?'; countQ += ' AND fe.status = ?'; params.push(status); }
    if (vehicleId) { q += ' AND fe.vehicleId = ?'; countQ += ' AND fe.vehicleId = ?'; params.push(vehicleId); }
    if (fuelType) { q += ' AND fe.fuelType = ?'; countQ += ' AND fe.fuelType = ?'; params.push(fuelType); }
    if (station) { q += ' AND fe.fuelStation LIKE ?'; countQ += ' AND fe.fuelStation LIKE ?'; params.push(`%${station}%`); }
    
    if (from && !Number.isNaN(from.getTime())) { q += ' AND fe.createdAt >= ?'; countQ += ' AND fe.createdAt >= ?'; params.push(from); }
    if (to && !Number.isNaN(to.getTime())) { q += ' AND fe.createdAt <= ?'; countQ += ' AND fe.createdAt <= ?'; params.push(to); }
    
    if (search) {
        const s = `%${search}%`;
        q += ' AND (fe.fuelStation LIKE ? OR fe.receiptNumber LIKE ? OR v.vehicleNumber LIKE ? OR u.name LIKE ?)';
        countQ += ' AND (fe.fuelStation LIKE ? OR fe.receiptNumber LIKE ? OR v.vehicleNumber LIKE ? OR u.name LIKE ?)';
        params.push(s, s, s, s);
    }
    
    q += ' ORDER BY fe.createdAt DESC LIMIT ? OFFSET ?';
    const pWithLimit = [...params, limit, skip];
    
    const [[rows], [[countRow]]] = await Promise.all([
        db.query(q, pWithLimit),
        db.query(countQ, params)
    ]);
    
    const items = [];
    if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        
        const [[receipts], [photos], [comments]] = await Promise.all([
            db.query(`SELECT fr.*, f.mimeType as f_mime, f.storageKey as f_key FROM FuelReceipt fr JOIN FileAsset f ON fr.fileId = f.id WHERE fr.fuelEntryId IN (${placeholders})`, ids),
            db.query(`SELECT fp.*, f.mimeType as f_mime, f.storageKey as f_key FROM FuelPhoto fp JOIN FileAsset f ON fp.fileId = f.id WHERE fp.fuelEntryId IN (${placeholders})`, ids),
            db.query(`SELECT c.*, u.name as u_name FROM FuelReviewComment c JOIN User u ON c.authorId = u.id WHERE c.fuelEntryId IN (${placeholders}) ORDER BY c.createdAt ASC`, ids)
        ]);
        
        const rMap = new Map(), pMap = new Map(), cMap = new Map();
        receipts.forEach(r => rMap.set(r.fuelEntryId, { ...r, file: { mimeType: r.f_mime, storageKey: r.f_key } }));
        photos.forEach(p => pMap.set(p.fuelEntryId, { ...p, file: { mimeType: p.f_mime, storageKey: p.f_key } }));
        comments.forEach(c => {
            if (!cMap.has(c.fuelEntryId)) cMap.set(c.fuelEntryId, []);
            cMap.get(c.fuelEntryId).push({ ...c, author: { name: c.u_name } });
        });
        
        for (const r of rows) {
            items.push({
                ...r,
                vehicle: { id: r.v_id, vehicleNumber: r.v_num },
                salesperson: { id: r.u_id, name: r.u_name, avatarUrl: r.u_avatarUrl },
                receipt: rMap.get(r.id) || null,
                fuelPhoto: pMap.get(r.id) || null,
                comments: cMap.get(r.id) || []
            });
        }
    }
    
    res.json({ items, pagination: { page, limit, total: countRow.c, pages: Math.max(1, Math.ceil(countRow.c / limit)) } });
});

fuelRouter.get('/entries/:id', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    let q = 'SELECT fe.*, v.id as v_id, v.vehicleNumber as v_num, u.id as u_id, u.name as u_name, u.avatarUrl as u_avatarUrl FROM FuelEntry fe JOIN Vehicle v ON fe.vehicleId = v.id JOIN User u ON fe.salespersonId = u.id WHERE fe.id = ? AND fe.tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    
    if (req.auth.role === Role.AGENT) {
        q += ' AND fe.salespersonId = ?';
        params.push(req.auth.sub);
    }
    
    const [rows] = await db.query(q, params);
    if (rows.length === 0) {
        return res.status(404).json({ error: { code: 'FUEL_ENTRY_NOT_FOUND' } });
    }
    const r = rows[0];
    const id = r.id;
    
    const [[receipts], [photos], [qr], [comments], [prev]] = await Promise.all([
        db.query(`SELECT fr.*, f.mimeType as f_mime, f.storageKey as f_key FROM FuelReceipt fr JOIN FileAsset f ON fr.fileId = f.id WHERE fr.fuelEntryId = ?`, [id]),
        db.query(`SELECT fp.*, f.mimeType as f_mime, f.storageKey as f_key FROM FuelPhoto fp JOIN FileAsset f ON fp.fileId = f.id WHERE fp.fuelEntryId = ?`, [id]),
        db.query(`SELECT q.*, f.mimeType as f_mime, f.storageKey as f_key FROM FuelQrEvidence q JOIN FileAsset f ON q.fileId = f.id WHERE q.fuelEntryId = ?`, [id]),
        db.query(`SELECT c.*, u.name as u_name FROM FuelReviewComment c JOIN User u ON c.authorId = u.id WHERE c.fuelEntryId = ? ORDER BY c.createdAt ASC`, [id]),
        db.query(`SELECT id, createdAt, odometerReading, liters, totalAmount, fuelStation FROM FuelEntry WHERE tenantId = ? AND vehicleId = ? AND createdAt < ? AND status != ? ORDER BY createdAt DESC LIMIT 1`, [req.auth.tenantId, r.vehicleId, r.createdAt, FuelClaimStatus.REJECTED])
    ]);
    
    const entry = {
        ...r,
        vehicle: { id: r.v_id, vehicleNumber: r.v_num },
        salesperson: { id: r.u_id, name: r.u_name, avatarUrl: r.u_avatarUrl },
        receipt: receipts[0] ? { ...receipts[0], file: { mimeType: receipts[0].f_mime, storageKey: receipts[0].f_key } } : null,
        fuelPhoto: photos[0] ? { ...photos[0], file: { mimeType: photos[0].f_mime, storageKey: photos[0].f_key } } : null,
        qrEvidence: qr[0] ? { ...qr[0], file: { mimeType: qr[0].f_mime, storageKey: qr[0].f_key } } : null,
        comments: comments.map(c => ({ ...c, author: { name: c.u_name } }))
    };
    
    res.json({ ...entry, previousEntry: prev[0] || null });
});

const entryInput = z.object({
    vehicleId: z.string().optional(), vehicleNumber: z.string().trim().min(2).max(30).optional(), fuelType: z.nativeEnum(FuelType), liters: z.coerce.number().positive().max(500),
    pricePerLiter: z.coerce.number().positive(), totalAmount: z.coerce.number().positive(),
    fuelStation: z.string().min(2).max(180), receiptNumber: z.string().min(1).max(100),
    odometerReading: z.coerce.number().nonnegative(), paymentMethod: z.string().min(2).max(60),
    notes: z.string().max(1000).optional(), isFullTank: z.boolean().default(false), latitude: z.coerce.number().min(-90).max(90),
    purchasedAt: z.coerce.date().refine((value) => value.getTime() <= Date.now() + 5 * 60 * 1000, 'Fuel date cannot be in the future').optional(),
    longitude: z.coerce.number().min(-180).max(180), gpsAccuracy: z.coerce.number().positive(),
    capturedAt: z.coerce.date().refine((value) => value.getTime() <= Date.now() + 5 * 60 * 1000, 'GPS timestamp cannot be in the future'),
    stationLatitude: z.coerce.number().min(-90).max(90).optional(),
    stationLongitude: z.coerce.number().min(-180).max(180).optional(), qrRawValue: z.string().max(2000).optional(),
    qrExtractedData: z.record(z.string(), z.unknown()).optional(),
    qrType: z.enum(['RECEIPT', 'AUTHORIZATION']).default('RECEIPT'),
});

fuelRouter.post('/entries', authorize(Role.AGENT), async (req, res) => {
    const input = entryInput.parse(req.body);
    const tenantId = req.auth.tenantId;
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let entryData = null;
    
    try {
        let newlyRegisteredVehicle = false;
        let vehicle = null;
        if (input.vehicleId) {
            const [vRows] = await connection.query('SELECT * FROM Vehicle WHERE id = ? AND tenantId = ? AND active = ? AND (assignedToId = ? OR assignedToId IS NULL)', [input.vehicleId, tenantId, true, req.auth.sub]);
            vehicle = vRows[0] || null;
        }
        
        if (!vehicle && input.vehicleNumber) {
            const vehicleNumber = input.vehicleNumber.toUpperCase().replace(/\s+/g, ' ').trim();
            const [existing] = await connection.query('SELECT * FROM Vehicle WHERE tenantId = ? AND vehicleNumber = ? AND active = ?', [tenantId, vehicleNumber, true]);
            if (existing.length > 0) {
                if (existing[0].assignedToId && existing[0].assignedToId !== req.auth.sub) {
                    throw new Error('INVALID_VEHICLE');
                }
                vehicle = existing[0];
            } else {
                const newVId = randomUUID();
                await connection.query(
                    'INSERT INTO Vehicle (id, tenantId, vehicleNumber, vehicleType, fuelType, tankCapacity, expectedKmL, minimumKmL, maximumKmL, currentOdometer, assignedToId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                    [newVId, tenantId, vehicleNumber, 'Pending verification', input.fuelType, 500, 12, 1, 100, 0, req.auth.sub, true]
                );
                const [newVRows] = await connection.query('SELECT * FROM Vehicle WHERE id = ?', [newVId]);
                vehicle = newVRows[0];
                newlyRegisteredVehicle = true;
            }
        }
        
        if (!vehicle) throw new Error('INVALID_VEHICLE');
        if (input.odometerReading < vehicle.currentOdometer) throw new Error('INVALID_ODOMETER');
        
        const [prevRows] = await connection.query('SELECT * FROM FuelEntry WHERE tenantId = ? AND vehicleId = ? AND status != ? ORDER BY odometerReading DESC LIMIT 1', [tenantId, vehicle.id, FuelClaimStatus.REJECTED]);
        const previous = prevRows[0];
        
        const recentTime = new Date(Date.now() - 30 * 60 * 1000);
        const [recentRows] = await connection.query('SELECT * FROM FuelEntry WHERE tenantId = ? AND vehicleId = ? AND createdAt >= ? LIMIT 1', [tenantId, vehicle.id, recentTime]);
        const recentFill = recentRows[0];
        
        const qrHash = input.qrRawValue ? createHash('sha256').update(input.qrRawValue).digest('hex') : null;
        let duplicateQr = null;
        if (qrHash) {
            const [qrRows] = await connection.query('SELECT * FROM FuelEntry WHERE tenantId = ? AND qrHash = ? LIMIT 1', [tenantId, qrHash]);
            duplicateQr = qrRows[0];
        }
        
        const purchaseTime = input.purchasedAt ?? new Date();
        const dayAgo = new Date(purchaseTime.getTime() - 24 * 60 * 60 * 1000);
        const dayAfter = new Date(purchaseTime.getTime() + 24 * 60 * 60 * 1000);
        
        const [dupRows] = await connection.query(
            'SELECT * FROM FuelEntry WHERE tenantId = ? AND purchasedAt >= ? AND purchasedAt <= ? AND ((receiptNumber = ? AND fuelStation = ?) OR (totalAmount >= ? AND totalAmount <= ? AND fuelStation = ?)) LIMIT 1',
            [tenantId, dayAgo, dayAfter, input.receiptNumber, input.fuelStation, input.totalAmount - 1, input.totalAmount + 1, input.fuelStation]
        );
        const duplicate = dupRows[0];
        
        const distance = previous ? input.odometerReading - previous.odometerReading : null;
        
        const startTravelTime = previous?.createdAt ?? monthStart();
        const [gpsTravelRows] = await connection.query('SELECT SUM(segmentDistanceMeters) as s FROM LocationPing WHERE tenantId = ? AND agentId = ? AND recordedAt >= ? AND recordedAt <= NOW()', [tenantId, req.auth.sub, startTravelTime]);
        const gpsTravelDistance = (gpsTravelRows[0].s ?? 0) / 1000;
        
        const efficiency = distance !== null && input.liters ? distance / input.liters : null;
        const expectedFuel = distance !== null ? distance / vehicle.expectedKmL : null;
        const variance = expectedFuel ? ((input.liters - expectedFuel) / expectedFuel) * 100 : null;
        
        let anomalyStatus = duplicate || duplicateQr ? FuelAnomalyStatus.DUPLICATE_SUSPECTED : FuelAnomalyStatus.NORMAL;
        if (newlyRegisteredVehicle && anomalyStatus === FuelAnomalyStatus.NORMAL) anomalyStatus = FuelAnomalyStatus.REVIEW_REQUIRED;
        if (recentFill && anomalyStatus === FuelAnomalyStatus.NORMAL) anomalyStatus = FuelAnomalyStatus.REVIEW_REQUIRED;
        if (!duplicate && (input.liters > vehicle.tankCapacity || (efficiency != null && (efficiency < vehicle.minimumKmL || efficiency > vehicle.maximumKmL)) || (variance != null && Math.abs(variance) > 20) || (distance != null && gpsTravelDistance > 0 && Math.abs(distance - gpsTravelDistance) > Math.max(5, distance * 0.2)))) {
            anomalyStatus = FuelAnomalyStatus.HIGH_VARIANCE;
        }
        
        const [budgetRows] = await connection.query('SELECT * FROM FuelBudget WHERE tenantId = ? AND month = ? AND salespersonId IS NULL AND vehicleId IS NULL', [tenantId, monthStart()]);
        const budget = budgetRows[0];
        if (budget) {
            const [spentRows] = await connection.query('SELECT SUM(totalAmount) as s FROM FuelEntry WHERE tenantId = ? AND createdAt >= ? AND status NOT IN (?, ?)', [tenantId, monthStart(), FuelClaimStatus.DRAFT, FuelClaimStatus.REJECTED]);
            const spent = Number(spentRows[0].s ?? 0);
            if (spent + input.totalAmount > Number(budget.companyAmount)) anomalyStatus = FuelAnomalyStatus.BUDGET_EXCEEDED;
        }
        
        let gpsStatus = FuelGpsStatus.GPS_UNAVAILABLE;
        let stationDistanceMeters = null;
        if (input.latitude != null && input.longitude != null && input.stationLatitude != null && input.stationLongitude != null) {
            stationDistanceMeters = haversine(input.latitude, input.longitude, input.stationLatitude, input.stationLongitude);
            gpsStatus = stationDistanceMeters <= 200 ? FuelGpsStatus.GPS_MATCH : stationDistanceMeters <= 1000 ? FuelGpsStatus.GPS_NEARBY : FuelGpsStatus.GPS_MISMATCH;
            if (gpsStatus === FuelGpsStatus.GPS_MISMATCH) anomalyStatus = FuelAnomalyStatus.GPS_MISMATCH;
        }
        
        const calculatedTotal = input.liters * input.pricePerLiter;
        if (Math.abs(calculatedTotal - input.totalAmount) > Math.max(2, calculatedTotal * 0.01)) throw new Error('INVALID_TOTAL');
        
        let authorization = null;
        if (input.qrRawValue && input.qrType === 'AUTHORIZATION') {
            const hash = createHash('sha256').update(input.qrRawValue).digest('hex');
            const [authRows] = await connection.query('SELECT * FROM FuelAuthorization WHERE tenantId = ? AND salespersonId = ? AND vehicleId = ? AND tokenHash = ? AND approvedFuelType = ? AND validFrom <= NOW() AND validUntil >= NOW() AND maximumLiters >= ? AND maximumAmount >= ? AND usedAt IS NULL', [tenantId, req.auth.sub, vehicle.id, hash, input.fuelType, input.liters, calculatedTotal]);
            authorization = authRows[0];
        }
        
        if (input.qrRawValue && input.qrType === 'AUTHORIZATION' && !authorization) throw new Error('INVALID_AUTHORIZATION');
        
        if (authorization?.singleUse) {
            await connection.query('UPDATE FuelAuthorization SET usedAt = NOW() WHERE id = ?', [authorization.id]);
        }
        
        const newEntryId = randomUUID();
        const litersPer100Km = distance ? (input.liters / distance) * 100 : null;
        const costPerKm = distance ? calculatedTotal / distance : null;
        
        let qrStatus = FuelQrStatus.UNVERIFIED;
        if (duplicateQr) qrStatus = FuelQrStatus.DUPLICATE;
        else if (authorization) qrStatus = FuelQrStatus.VERIFIED;
        else if (input.qrRawValue) qrStatus = FuelQrStatus.UNVERIFIED;
        
        await connection.query(
            `INSERT INTO FuelEntry (id, tenantId, salespersonId, vehicleId, fuelType, liters, pricePerLiter, totalAmount, fuelStation, receiptNumber, odometerReading, paymentMethod, notes, isFullTank, purchasedAt, latitude, longitude, gpsAccuracy, gpsCapturedAt, stationLatitude, stationLongitude, stationDistanceMeters, gpsStatus, gpsDistance, anomalyStatus, odometerDistance, efficiencyKmL, litersPer100Km, costPerKm, expectedFuel, variancePercent, qrRawValue, qrExtractedData, qrHash, qrVerified, qrStatus, qrScannedAt, authorizationId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [newEntryId, tenantId, req.auth.sub, vehicle.id, input.fuelType, input.liters, input.pricePerLiter, calculatedTotal, input.fuelStation, input.receiptNumber, input.odometerReading, input.paymentMethod, input.notes || null, input.isFullTank, purchaseTime, input.latitude, input.longitude, input.gpsAccuracy, input.capturedAt, input.stationLatitude || null, input.stationLongitude || null, stationDistanceMeters, gpsStatus, gpsTravelDistance, anomalyStatus, distance, efficiency, litersPer100Km, costPerKm, expectedFuel, variance, input.qrRawValue || null, input.qrExtractedData ? JSON.stringify(input.qrExtractedData) : null, qrHash, input.qrRawValue ? Boolean(authorization) : false, qrStatus, input.qrRawValue ? new Date() : null, authorization?.id || null, FuelClaimStatus.DRAFT]
        );
        
        const [neRows] = await connection.query('SELECT * FROM FuelEntry WHERE id = ?', [newEntryId]);
        entryData = neRows[0];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        connection.release();
        if (err instanceof Error && ['INVALID_VEHICLE', 'INVALID_ODOMETER', 'INVALID_TOTAL', 'INVALID_AUTHORIZATION'].includes(err.message)) {
            return res.status(422).json({ error: { code: err.message } });
        }
        throw err;
    }
    
    connection.release();
    
    await audit(tenantId, req.auth.sub, 'FUEL_ENTRY_CREATED', entryData.id, entryData);
    emit(req, 'fuel:entry-created', entryData);
    res.status(201).json(entryData);
});

fuelRouter.post('/entries/:id/receipt', authorize(Role.AGENT), upload.single('receipt'), async (req, res) => {
    if (!req.file) return res.status(422).json({ error: { code: 'RECEIPT_REQUIRED' } });
    const id = String(req.params.id);
    
    const [entries] = await db.query('SELECT * FROM FuelEntry WHERE id = ? AND tenantId = ? AND salespersonId = ? AND status IN (?, ?)', [id, req.auth.tenantId, req.auth.sub, FuelClaimStatus.DRAFT, FuelClaimStatus.SUBMITTED]);
    const entry = entries[0];
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const [dupes] = await db.query('SELECT * FROM FuelReceipt WHERE fileHash = ? AND fuelEntryId != ?', [fileHash, id]);
    const duplicate = dupes[0];
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let saved;
    try {
        const file = await createFileAsset(req.auth.tenantId, req.auth.sub, toStoredUpload(req.file), connection);
        
        const [existing] = await connection.query('SELECT id FROM FuelReceipt WHERE fuelEntryId = ?', [id]);
        if (existing.length > 0) {
            await connection.query('UPDATE FuelReceipt SET fileId = ?, fileHash = ? WHERE fuelEntryId = ?', [file.id, fileHash, id]);
        } else {
            await connection.query('INSERT INTO FuelReceipt (id, fuelEntryId, fileId, fileHash) VALUES (?, ?, ?)', [id, file.id, fileHash]);
        }
        
        const [sRows] = await connection.query('SELECT * FROM FuelReceipt WHERE fuelEntryId = ?', [id]);
        saved = sRows[0];
        
        if (duplicate) {
            await connection.query('UPDATE FuelEntry SET anomalyStatus = ? WHERE id = ?', [FuelAnomalyStatus.DUPLICATE_SUSPECTED, id]);
        }
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
    
    await audit(req.auth.tenantId, req.auth.sub, 'FUEL_RECEIPT_UPLOADED', id, { fileHash, duplicate: Boolean(duplicate) });
    res.status(201).json({ ...saved, duplicate: Boolean(duplicate) });
});

fuelRouter.get('/entries/:id/receipt', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    let q = 'SELECT fr.*, f.mimeType, f.storageKey FROM FuelReceipt fr JOIN FuelEntry fe ON fr.fuelEntryId = fe.id JOIN FileAsset f ON fr.fileId = f.id WHERE fe.id = ? AND fe.tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        q += ' AND fe.salespersonId = ?';
        params.push(req.auth.sub);
    }
    
    const [rows] = await db.query(q, params);
    const receipt = rows[0];
    if (!receipt) return res.status(404).json({ error: { code: 'RECEIPT_NOT_FOUND' } });
    
    res.type(receipt.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return redirectToSignedObject(res, receipt.storageKey);
});

fuelRouter.post('/entries/:id/fuel-photo', authorize(Role.AGENT), upload.single('fuelPhoto'), async (req, res) => {
    if (!req.file || !req.file.mimetype.startsWith('image/')) return res.status(422).json({ error: { code: 'FUEL_PHOTO_REQUIRED' } });
    const id = String(req.params.id);
    
    const [entries] = await db.query('SELECT * FROM FuelEntry WHERE id = ? AND tenantId = ? AND salespersonId = ? AND status IN (?, ?)', [id, req.auth.tenantId, req.auth.sub, FuelClaimStatus.DRAFT, FuelClaimStatus.SUBMITTED]);
    if (entries.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let saved;
    try {
        const file = await createFileAsset(req.auth.tenantId, req.auth.sub, toStoredUpload(req.file), connection);
        const [existing] = await connection.query('SELECT id FROM FuelPhoto WHERE fuelEntryId = ?', [id]);
        if (existing.length > 0) {
            await connection.query('UPDATE FuelPhoto SET fileId = ?, fileHash = ? WHERE fuelEntryId = ?', [file.id, fileHash, id]);
        } else {
            await connection.query('INSERT INTO FuelPhoto (id, fuelEntryId, fileId, fileHash) VALUES (?, ?, ?)', [id, file.id, fileHash]);
        }
        const [sRows] = await connection.query('SELECT * FROM FuelPhoto WHERE fuelEntryId = ?', [id]);
        saved = sRows[0];
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
    
    await audit(req.auth.tenantId, req.auth.sub, 'FUEL_PUMP_PHOTO_UPLOADED', id, { fileHash });
    res.status(201).json(saved);
});

fuelRouter.get('/entries/:id/fuel-photo', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    let q = 'SELECT fp.*, f.mimeType, f.storageKey FROM FuelPhoto fp JOIN FuelEntry fe ON fp.fuelEntryId = fe.id JOIN FileAsset f ON fp.fileId = f.id WHERE fe.id = ? AND fe.tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        q += ' AND fe.salespersonId = ?';
        params.push(req.auth.sub);
    }
    const [rows] = await db.query(q, params);
    const photo = rows[0];
    if (!photo) return res.status(404).json({ error: { code: 'FUEL_PHOTO_NOT_FOUND' } });
    
    res.type(photo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return redirectToSignedObject(res, photo.storageKey);
});

fuelRouter.post('/entries/:id/qr-image', authorize(Role.AGENT), upload.single('qrImage'), async (req, res) => {
    if (!req.file) return res.status(422).json({ error: { code: 'QR_IMAGE_REQUIRED' } });
    const id = String(req.params.id);
    
    const [entries] = await db.query('SELECT * FROM FuelEntry WHERE id = ? AND tenantId = ? AND salespersonId = ? AND status IN (?, ?)', [id, req.auth.tenantId, req.auth.sub, FuelClaimStatus.DRAFT, FuelClaimStatus.SUBMITTED]);
    if (entries.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const [dupes] = await db.query('SELECT * FROM FuelQrEvidence WHERE fileHash = ? AND fuelEntryId != ?', [fileHash, id]);
    const duplicate = dupes[0];
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let saved;
    try {
        const file = await createFileAsset(req.auth.tenantId, req.auth.sub, toStoredUpload(req.file), connection);
        const [existing] = await connection.query('SELECT id FROM FuelQrEvidence WHERE fuelEntryId = ?', [id]);
        if (existing.length > 0) {
            await connection.query('UPDATE FuelQrEvidence SET fileId = ?, fileHash = ? WHERE fuelEntryId = ?', [file.id, fileHash, id]);
        } else {
            await connection.query('INSERT INTO FuelQrEvidence (id, fuelEntryId, fileId, fileHash) VALUES (?, ?, ?)', [id, file.id, fileHash]);
        }
        const [sRows] = await connection.query('SELECT * FROM FuelQrEvidence WHERE fuelEntryId = ?', [id]);
        saved = sRows[0];
        if (duplicate) {
            await connection.query('UPDATE FuelEntry SET qrStatus = ?, anomalyStatus = ? WHERE id = ?', [FuelQrStatus.DUPLICATE, FuelAnomalyStatus.DUPLICATE_SUSPECTED, id]);
        }
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
    
    await audit(req.auth.tenantId, req.auth.sub, 'FUEL_QR_IMAGE_UPLOADED', id, { fileHash, duplicate: Boolean(duplicate) });
    res.status(201).json({ ...saved, duplicate: Boolean(duplicate) });
});

fuelRouter.get('/entries/:id/qr-image', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    let q = 'SELECT q.*, f.mimeType, f.storageKey FROM FuelQrEvidence q JOIN FuelEntry fe ON q.fuelEntryId = fe.id JOIN FileAsset f ON q.fileId = f.id WHERE fe.id = ? AND fe.tenantId = ?';
    const params = [String(req.params.id), req.auth.tenantId];
    if (req.auth.role === Role.AGENT) {
        q += ' AND fe.salespersonId = ?';
        params.push(req.auth.sub);
    }
    const [rows] = await db.query(q, params);
    const evidence = rows[0];
    if (!evidence) return res.status(404).json({ error: { code: 'QR_IMAGE_NOT_FOUND' } });
    
    res.type(evidence.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return redirectToSignedObject(res, evidence.storageKey);
});

fuelRouter.post('/entries/:id/submit', authorize(Role.AGENT), async (req, res) => {
    const id = String(req.params.id);
    const [entries] = await db.query('SELECT * FROM FuelEntry WHERE id = ? AND tenantId = ? AND salespersonId = ? AND status = ?', [id, req.auth.tenantId, req.auth.sub, FuelClaimStatus.DRAFT]);
    const draft = entries[0];
    if (!draft) return res.status(409).json({ error: { code: 'NOT_DRAFT' } });
    
    const [receipts] = await db.query('SELECT id FROM FuelReceipt WHERE fuelEntryId = ?', [id]);
    if (receipts.length === 0) return res.status(422).json({ error: { code: 'RECEIPT_REQUIRED' } });
    
    const [photos] = await db.query('SELECT id FROM FuelPhoto WHERE fuelEntryId = ?', [id]);
    if (photos.length === 0) return res.status(422).json({ error: { code: 'FUEL_PHOTO_REQUIRED' } });
    
    if (draft.latitude == null || draft.longitude == null || draft.gpsAccuracy == null || draft.gpsCapturedAt == null) {
        return res.status(422).json({ error: { code: 'CLAIM_GPS_REQUIRED' } });
    }
    
    await db.query('UPDATE FuelEntry SET status = ?, updatedAt = NOW() WHERE id = ?', [FuelClaimStatus.SUBMITTED, id]);
    
    const [updatedRows] = await db.query('SELECT fe.*, v.vehicleNumber, u.name as salespersonName FROM FuelEntry fe JOIN Vehicle v ON fe.vehicleId = v.id JOIN User u ON fe.salespersonId = u.id WHERE fe.id = ?', [id]);
    const entry = updatedRows[0];
    
    await db.query(
        'INSERT INTO Notification (id, tenantId, type, title, message, createdAt) VALUES (?, ?, ?, ?, NOW())',
        [req.auth.tenantId, 'NEW_FUEL_CLAIM', 'New fuel claim', `${entry.salespersonName} submitted ${entry.liters} L for ${entry.vehicleNumber}`]
    );
    
    await audit(req.auth.tenantId, req.auth.sub, 'FUEL_CLAIM_SUBMITTED', id);
    emit(req, 'fuel:claim-submitted', entry);
    res.json(entry);
});

fuelRouter.patch('/entries/:id/review', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const id = String(req.params.id);
    const input = z.object({
        status: z.enum(['VERIFIED', 'APPROVED', 'REJECTED', 'FLAGGED']),
        comment: z.string().max(1000).optional(),
    }).parse(req.body);
    
    const [entries] = await db.query('SELECT * FROM FuelEntry WHERE id = ? AND tenantId = ?', [id, req.auth.tenantId]);
    const current = entries[0];
    if (!current) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    
    if (current.status !== FuelClaimStatus.SUBMITTED && current.status !== FuelClaimStatus.VERIFIED && current.status !== FuelClaimStatus.FLAGGED) {
        return res.status(409).json({ error: { code: 'INVALID_CLAIM_TRANSITION' } });
    }
    
    if ((input.status === 'REJECTED' || input.status === 'FLAGGED') && !input.comment?.trim()) {
        return res.status(422).json({ error: { code: 'COMMENT_REQUIRED' } });
    }
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let updated;
    try {
        await connection.query(
            'UPDATE FuelEntry SET status = ?, reviewedById = ?, reviewedAt = NOW(), reviewComment = ?, updatedAt = NOW() WHERE id = ?',
            [input.status, req.auth.sub, input.comment || null, id]
        );
        
        if (input.comment) {
            await connection.query(
                'INSERT INTO FuelReviewComment (id, tenantId, fuelEntryId, authorId, comment, createdAt) VALUES (?, ?, ?, ?, NOW())',
                [req.auth.tenantId, id, req.auth.sub, input.comment]
            );
        }
        
        if (input.status === 'APPROVED') {
            await connection.query('UPDATE Vehicle SET currentOdometer = GREATEST(currentOdometer, ?) WHERE id = ?', [Math.max(current.odometerReading, 0), current.vehicleId]);
            
            const [dailyRows] = await connection.query('SELECT id FROM DailyFuelRecord WHERE tenantId = ? AND vehicleId = ? AND recordDate = ?', [req.auth.tenantId, current.vehicleId, utcDay(new Date(current.purchasedAt))]);
            const daily = dailyRows[0];
            if (daily) {
                await connection.query('UPDATE DailyFuelRecord SET fuelAddedLiters = fuelAddedLiters + ? WHERE id = ?', [current.liters, daily.id]);
                await connection.query('UPDATE FuelEntry SET dailyFuelRecordId = ? WHERE id = ?', [daily.id, id]);
            }
        }
        
        await connection.query(
            'INSERT INTO Notification (id, tenantId, userId, type, title, message, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
            [req.auth.tenantId, current.salespersonId, `FUEL_CLAIM_${input.status}`, `Fuel claim ${input.status.toLowerCase().replace('_', ' ')}`, input.comment || `Your fuel claim has been ${input.status.toLowerCase()}.`]
        );
        
        const [uRows] = await connection.query('SELECT * FROM FuelEntry WHERE id = ?', [id]);
        updated = uRows[0];
        
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
    
    await audit(req.auth.tenantId, req.auth.sub, `FUEL_CLAIM_${input.status}`, id, { old: current.status, new: input.status });
    emit(req, 'fuel:claim-reviewed', updated);
    res.json(updated);
});

fuelRouter.get('/daily', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    const from = req.query.from ? utcDay(new Date(String(req.query.from))) : utcDay();
    const toValue = req.query.to ? utcDay(new Date(String(req.query.to))) : from;
    const to = new Date(toValue.getTime() + 86_400_000);
    
    let q = 'SELECT d.*, v.id as v_id, v.vehicleNumber as v_num, u.id as u_id, u.name as u_name FROM DailyFuelRecord d JOIN Vehicle v ON d.vehicleId = v.id JOIN User u ON d.salespersonId = u.id WHERE d.tenantId = ? AND d.recordDate >= ? AND d.recordDate < ?';
    const params = [req.auth.tenantId, from, to];
    if (req.auth.role === Role.AGENT) {
        q += ' AND d.salespersonId = ?';
        params.push(req.auth.sub);
    }
    q += ' ORDER BY d.recordDate DESC, d.openedAt DESC';
    
    const [rows] = await db.query(q, params);
    const records = [];
    
    if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        
        const [[photos], [entries]] = await Promise.all([
            db.query(`SELECT dp.*, f.mimeType, f.storageKey FROM DailyFuelPhoto dp JOIN FileAsset f ON dp.fileId = f.id WHERE dp.recordId IN (${placeholders})`, ids),
            db.query(`SELECT id, liters, totalAmount, receiptNumber, dailyFuelRecordId FROM FuelEntry WHERE dailyFuelRecordId IN (${placeholders}) AND status IN (?, ?)`, [...ids, FuelClaimStatus.APPROVED, FuelClaimStatus.REIMBURSED])
        ]);
        
        const pMap = new Map(), eMap = new Map();
        photos.forEach(p => {
            if (!pMap.has(p.recordId)) pMap.set(p.recordId, []);
            pMap.get(p.recordId).push({ ...p, file: { mimeType: p.mimeType, storageKey: p.storageKey } });
        });
        entries.forEach(e => {
            if (!eMap.has(e.dailyFuelRecordId)) eMap.set(e.dailyFuelRecordId, []);
            eMap.get(e.dailyFuelRecordId).push(e);
        });
        
        for (const r of rows) {
            records.push({
                ...r,
                anomalyReasons: r.anomalyReasons ? JSON.parse(r.anomalyReasons) : [],
                vehicle: { id: r.v_id, vehicleNumber: r.v_num },
                salesperson: { id: r.u_id, name: r.u_name },
                photos: pMap.get(r.id) || [],
                fuelEntries: eMap.get(r.id) || []
            });
        }
    }
    
    res.json(records);
});

fuelRouter.post('/daily/start', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({
        vehicleId: z.string(), openingFuelLiters: z.coerce.number().nonnegative(), openingOdometer: z.coerce.number().nonnegative(),
        latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), gpsAccuracy: z.coerce.number().positive().optional(),
    }).parse(req.body);
    
    const [vehicles] = await db.query('SELECT * FROM Vehicle WHERE id = ? AND tenantId = ? AND active = ? AND (assignedToId = ? OR assignedToId IS NULL)', [input.vehicleId, req.auth.tenantId, true, req.auth.sub]);
    const vehicle = vehicles[0];
    if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
    
    const reasons = [];
    if (input.openingFuelLiters > vehicle.tankCapacity) reasons.push('FUEL_EXCEEDS_TANK_CAPACITY');
    if (input.openingOdometer < vehicle.currentOdometer) reasons.push('ODOMETER_BELOW_VEHICLE_READING');
    if ((input.gpsAccuracy ?? 999) > 100) reasons.push('SUSPICIOUS_GPS');
    
    const dId = randomUUID();
    try {
        await db.query(
            'INSERT INTO DailyFuelRecord (id, tenantId, salespersonId, vehicleId, recordDate, openingFuelLiters, openingOdometer, openingLatitude, openingLongitude, openingGpsAccuracy, status, anomalyReasons, openedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
            [dId, req.auth.tenantId, req.auth.sub, vehicle.id, utcDay(), input.openingFuelLiters, input.openingOdometer, input.latitude, input.longitude, input.gpsAccuracy || null, reasons.length ? 'FLAGGED' : 'OPEN', JSON.stringify(reasons)]
        );
        
        const [rows] = await db.query('SELECT * FROM DailyFuelRecord WHERE id = ?', [dId]);
        const record = rows[0];
        await audit(req.auth.tenantId, req.auth.sub, 'DAILY_FUEL_SHIFT_STARTED', record.id, { reasons });
        res.status(201).json(record);
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: { code: 'DAILY_SHIFT_ALREADY_EXISTS' } });
        throw e;
    }
});

fuelRouter.patch('/daily/:id/end', authorize(Role.AGENT), async (req, res) => {
    const input = z.object({
        closingFuelLiters: z.coerce.number().nonnegative(), closingOdometer: z.coerce.number().nonnegative(),
        latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), gpsAccuracy: z.coerce.number().positive().optional(),
    }).parse(req.body);
    
    const [currentRows] = await db.query('SELECT d.*, v.tankCapacity, v.currentOdometer as v_odometer, v.minimumKmL FROM DailyFuelRecord d JOIN Vehicle v ON d.vehicleId = v.id WHERE d.id = ? AND d.tenantId = ? AND d.salespersonId = ? AND d.closedAt IS NULL', [String(req.params.id), req.auth.tenantId, req.auth.sub]);
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: { code: 'OPEN_DAILY_SHIFT_NOT_FOUND' } });
    
    const distance = input.closingOdometer - current.openingOdometer;
    const fuelUsed = current.openingFuelLiters + current.fuelAddedLiters - input.closingFuelLiters;
    const efficiency = fuelUsed > 0 && distance >= 0 ? distance / fuelUsed : null;
    
    const reasons = current.anomalyReasons ? JSON.parse(current.anomalyReasons) : [];
    if (distance < 0) reasons.push('CLOSING_ODOMETER_BELOW_OPENING');
    if (input.closingFuelLiters > current.tankCapacity) reasons.push('FUEL_EXCEEDS_TANK_CAPACITY');
    if (fuelUsed < 0) reasons.push('NEGATIVE_FUEL_USAGE');
    if (efficiency != null && efficiency < current.minimumKmL) reasons.push('ABNORMALLY_HIGH_FUEL_USAGE');
    if ((input.gpsAccuracy ?? 999) > 100 || haversine(current.openingLatitude, current.openingLongitude, input.latitude, input.longitude) > Math.max(10_000, Math.max(distance, 0) * 2_000)) reasons.push('SUSPICIOUS_GPS');
    
    const uniqueReasons = [...new Set(reasons)];
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let record;
    try {
        await connection.query('UPDATE Vehicle SET currentOdometer = GREATEST(currentOdometer, ?) WHERE id = ?', [input.closingOdometer, current.vehicleId]);
        await connection.query(
            'UPDATE DailyFuelRecord SET closingFuelLiters = ?, closingOdometer = ?, closingLatitude = ?, closingLongitude = ?, closingGpsAccuracy = ?, closedAt = NOW(), distanceTravelled = ?, fuelUsedLiters = ?, fuelEfficiencyKmL = ?, status = ?, anomalyReasons = ?, updatedAt = NOW() WHERE id = ?',
            [input.closingFuelLiters, input.closingOdometer, input.latitude, input.longitude, input.gpsAccuracy || null, distance, fuelUsed, efficiency, uniqueReasons.length ? 'FLAGGED' : 'CLOSED', JSON.stringify(uniqueReasons), current.id]
        );
        const [rows] = await connection.query('SELECT * FROM DailyFuelRecord WHERE id = ?', [current.id]);
        record = rows[0];
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
    
    await audit(req.auth.tenantId, req.auth.sub, 'DAILY_FUEL_SHIFT_CLOSED', record.id, { distance, fuelUsed, efficiency, reasons: uniqueReasons });
    emit(req, 'fuel:daily-shift-closed', record);
    res.json(record);
});

fuelRouter.post('/daily/:id/photo/:kind', authorize(Role.AGENT), upload.single('photo'), async (req, res) => {
    const kind = String(req.params.kind).toUpperCase();
    if (!req.file?.mimetype.startsWith('image/') || !['OPENING', 'CLOSING'].includes(kind)) return res.status(422).json({ error: { code: 'VALID_IMAGE_REQUIRED' } });
    
    const [records] = await db.query('SELECT id FROM DailyFuelRecord WHERE id = ? AND tenantId = ? AND salespersonId = ?', [String(req.params.id), req.auth.tenantId, req.auth.sub]);
    if (records.length === 0) return res.status(404).json({ error: { code: 'DAILY_RECORD_NOT_FOUND' } });
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let photo;
    try {
        const file = await createFileAsset(req.auth.tenantId, req.auth.sub, toStoredUpload(req.file), connection);
        const [existing] = await connection.query('SELECT id FROM DailyFuelPhoto WHERE recordId = ? AND kind = ?', [records[0].id, kind]);
        if (existing.length > 0) {
            await connection.query('UPDATE DailyFuelPhoto SET fileId = ? WHERE recordId = ? AND kind = ?', [file.id, records[0].id, kind]);
            const [pRows] = await connection.query('SELECT * FROM DailyFuelPhoto WHERE recordId = ? AND kind = ?', [records[0].id, kind]);
            photo = pRows[0];
        } else {
            const pid = randomUUID();
            await connection.query('INSERT INTO DailyFuelPhoto (id, recordId, kind, fileId) VALUES (?, ?, ?, ?)', [pid, records[0].id, kind, file.id]);
            const [pRows] = await connection.query('SELECT * FROM DailyFuelPhoto WHERE id = ?', [pid]);
            photo = pRows[0];
        }
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
    res.status(201).json(photo);
});

fuelRouter.get('/daily/:id/photo/:kind', authorize(Role.AGENT, Role.MANAGER, Role.ADMIN), async (req, res) => {
    const kind = String(req.params.kind).toUpperCase();
    let q = 'SELECT f.mimeType, f.storageKey FROM DailyFuelPhoto dp JOIN DailyFuelRecord d ON dp.recordId = d.id JOIN FileAsset f ON dp.fileId = f.id WHERE d.id = ? AND d.tenantId = ? AND dp.kind = ?';
    const params = [String(req.params.id), req.auth.tenantId, kind];
    if (req.auth.role === Role.AGENT) {
        q += ' AND d.salespersonId = ?';
        params.push(req.auth.sub);
    }
    const [rows] = await db.query(q, params);
    const file = rows[0];
    if (!file) return res.status(404).json({ error: { code: 'DAILY_PHOTO_NOT_FOUND' } });
    
    res.type(file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return redirectToSignedObject(res, file.storageKey);
});

fuelRouter.patch('/daily/:id/flag', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const input = z.object({ reason: z.enum(['PHOTO_ENTRY_MISMATCH', 'SUSPICIOUS_GPS', 'OTHER']) }).parse(req.body);
    const [records] = await db.query('SELECT * FROM DailyFuelRecord WHERE id = ? AND tenantId = ?', [String(req.params.id), req.auth.tenantId]);
    const current = records[0];
    if (!current) return res.status(404).json({ error: { code: 'DAILY_RECORD_NOT_FOUND' } });
    
    const reasons = [...new Set([...(current.anomalyReasons ? JSON.parse(current.anomalyReasons) : []), input.reason])];
    await db.query('UPDATE DailyFuelRecord SET status = ?, anomalyReasons = ?, updatedAt = NOW() WHERE id = ?', ['FLAGGED', JSON.stringify(reasons), current.id]);
    
    const [updatedRows] = await db.query('SELECT * FROM DailyFuelRecord WHERE id = ?', [current.id]);
    const updated = updatedRows[0];
    
    await audit(req.auth.tenantId, req.auth.sub, 'DAILY_FUEL_RECORD_FLAGGED', current.id, { reason: input.reason });
    res.json(updated);
});

fuelRouter.get('/dashboard', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const from = monthStart();
    const historyFrom = new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth() + 1, 1));
    
    const [[entriesRows], [historyRows], [budgetRows]] = await Promise.all([
        db.query('SELECT fe.*, v.id as v_id, v.vehicleNumber as v_num, u.id as u_id, u.name as u_name FROM FuelEntry fe JOIN Vehicle v ON fe.vehicleId = v.id JOIN User u ON fe.salespersonId = u.id WHERE fe.tenantId = ? AND fe.createdAt >= ? ORDER BY fe.createdAt DESC', [req.auth.tenantId, from]),
        db.query('SELECT fe.*, v.id as v_id, v.vehicleNumber as v_num FROM FuelEntry fe JOIN Vehicle v ON fe.vehicleId = v.id WHERE fe.tenantId = ? AND fe.createdAt >= ? AND fe.status IN (?, ?) ORDER BY fe.createdAt ASC', [req.auth.tenantId, historyFrom, FuelClaimStatus.APPROVED, FuelClaimStatus.REIMBURSED]),
        db.query('SELECT * FROM FuelBudget WHERE tenantId = ? AND month = ? AND salespersonId IS NULL AND vehicleId IS NULL', [req.auth.tenantId, from])
    ]);
    
    const entries = entriesRows.map(r => ({ ...r, vehicle: { id: r.v_id, vehicleNumber: r.v_num }, salesperson: { id: r.u_id, name: r.u_name } }));
    const history = historyRows.map(r => ({ ...r, vehicle: { id: r.v_id, vehicleNumber: r.v_num } }));
    const budget = budgetRows[0];
    
    const approved = entries.filter((entry) => entry.status === FuelClaimStatus.APPROVED || entry.status === FuelClaimStatus.REIMBURSED);
    const totalCost = approved.reduce((sum, entry) => sum + Number(entry.totalAmount), 0);
    const liters = approved.reduce((sum, entry) => sum + entry.liters, 0);
    const distance = approved.reduce((sum, entry) => sum + (entry.odometerDistance ?? 0), 0);
    const monthlyBudget = Number(budget?.companyAmount ?? 250_000);
    
    const bySalesperson = Object.values(entries.reduce((summary, entry) => {
        const person = summary[entry.salespersonId] ?? { name: entry.salesperson.name, cost: 0, liters: 0 };
        person.cost += Number(entry.totalAmount);
        person.liters += entry.liters;
        summary[entry.salespersonId] = person;
        return summary;
    }, {}));
    
    const byVehicle = Object.values(approved.reduce((summary, entry) => {
        const vehicle = summary[entry.vehicleId] ?? { name: entry.vehicle.vehicleNumber, cost: 0, liters: 0, distance: 0 };
        vehicle.cost += Number(entry.totalAmount);
        vehicle.liters += entry.liters;
        vehicle.distance += entry.odometerDistance ?? 0;
        summary[entry.vehicleId] = vehicle;
        return summary;
    }, {})).map((vehicle) => ({ ...vehicle, efficiencyKmL: vehicle.liters ? vehicle.distance / vehicle.liters : 0 }));
    
    const monthlyTrend = Object.values(history.reduce((summary, entry) => {
        const key = new Date(entry.createdAt).toISOString().slice(0, 7);
        const month = summary[key] ?? { month: key, cost: 0, liters: 0, distance: 0 };
        month.cost += Number(entry.totalAmount);
        month.liters += entry.liters;
        month.distance += entry.odometerDistance ?? 0;
        summary[key] = month;
        return summary;
    }, {}));
    
    res.json({
        kpis: {
            monthlyBudget, totalCost, remainingBudget: Math.max(0, monthlyBudget - totalCost), liters,
            estimatedConsumed: approved.reduce((sum, entry) => sum + (entry.expectedFuel ?? entry.liters), 0), distance,
            averageKmL: liters ? distance / liters : 0, costPerKm: distance ? totalCost / distance : 0,
            pending: entries.filter((entry) => entry.status === FuelClaimStatus.SUBMITTED || entry.status === FuelClaimStatus.VERIFIED).length,
            rejected: entries.filter((entry) => entry.status === FuelClaimStatus.REJECTED).length,
            suspicious: entries.filter((entry) => entry.anomalyStatus !== FuelAnomalyStatus.NORMAL).length,
        },
        entries, bySalesperson, byVehicle, monthlyTrend,
    });
});

fuelRouter.get('/wallet', authorize(Role.AGENT), async (req, res) => {
    const from = monthStart();
    const [[entries], [budgetRows]] = await Promise.all([
        db.query('SELECT * FROM FuelEntry WHERE tenantId = ? AND salespersonId = ? AND createdAt >= ?', [req.auth.tenantId, req.auth.sub, from]),
        db.query('SELECT * FROM FuelBudget WHERE tenantId = ? AND month = ? AND (salespersonId = ? OR (salespersonId IS NULL AND vehicleId IS NULL)) ORDER BY salespersonId DESC', [req.auth.tenantId, from, req.auth.sub])
    ]);
    
    const budget = budgetRows[0];
    const counted = entries.filter((entry) => entry.status !== FuelClaimStatus.REJECTED && entry.status !== FuelClaimStatus.DRAFT);
    const used = counted.reduce((sum, entry) => sum + Number(entry.totalAmount), 0);
    const allowance = Number(budget?.monthlyLimit ?? budget?.companyAmount ?? 0);
    
    res.json({ allowance, used, remaining: Math.max(0, allowance - used), liters: counted.reduce((sum, entry) => sum + entry.liters, 0) });
});

fuelRouter.put('/budget', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const input = z.object({
        companyAmount: z.coerce.number().nonnegative(), dailyLimit: z.coerce.number().nonnegative().optional(),
        weeklyLimit: z.coerce.number().nonnegative().optional(), monthlyLimit: z.coerce.number().nonnegative().optional(),
        literLimit: z.coerce.number().nonnegative().optional(), salespersonId: z.string().optional(), vehicleId: z.string().optional(),
    }).parse(req.body);
    
    const month = monthStart();
    let q = 'SELECT * FROM FuelBudget WHERE tenantId = ? AND month = ?';
    const params = [req.auth.tenantId, month];
    
    if (input.salespersonId) { q += ' AND salespersonId = ?'; params.push(input.salespersonId); } else { q += ' AND salespersonId IS NULL'; }
    if (input.vehicleId) { q += ' AND vehicleId = ?'; params.push(input.vehicleId); } else { q += ' AND vehicleId IS NULL'; }
    
    const [existingRows] = await db.query(q, params);
    let budget;
    
    if (existingRows.length > 0) {
        await db.query(
            'UPDATE FuelBudget SET companyAmount = ?, dailyLimit = ?, weeklyLimit = ?, monthlyLimit = ?, literLimit = ?, updatedAt = NOW() WHERE id = ?',
            [input.companyAmount, input.dailyLimit || null, input.weeklyLimit || null, input.monthlyLimit || null, input.literLimit || null, existingRows[0].id]
        );
        const [bRows] = await db.query('SELECT * FROM FuelBudget WHERE id = ?', [existingRows[0].id]);
        budget = bRows[0];
    } else {
        const id = randomUUID();
        await db.query(
            'INSERT INTO FuelBudget (id, tenantId, month, companyAmount, dailyLimit, weeklyLimit, monthlyLimit, literLimit, salespersonId, vehicleId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [id, req.auth.tenantId, month, input.companyAmount, input.dailyLimit || null, input.weeklyLimit || null, input.monthlyLimit || null, input.literLimit || null, input.salespersonId || null, input.vehicleId || null]
        );
        const [bRows] = await db.query('SELECT * FROM FuelBudget WHERE id = ?', [id]);
        budget = bRows[0];
    }
    
    await audit(req.auth.tenantId, req.auth.sub, 'FUEL_BUDGET_CHANGED', budget.id, input);
    res.json(budget);
});

fuelRouter.post('/authorizations', authorize(Role.MANAGER, Role.ADMIN), async (req, res) => {
    const input = z.object({
        salespersonId: z.string(), vehicleId: z.string(), maximumLiters: z.coerce.number().positive(),
        maximumAmount: z.coerce.number().positive(), validFrom: z.string().datetime(), validUntil: z.string().datetime(),
        approvedFuelType: z.nativeEnum(FuelType), singleUse: z.boolean().default(true),
    }).parse(req.body);
    
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    
    await db.query(
        'INSERT INTO FuelAuthorization (id, tenantId, createdById, salespersonId, vehicleId, maximumLiters, maximumAmount, validFrom, validUntil, approvedFuelType, singleUse, tokenHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, req.auth.tenantId, req.auth.sub, input.salespersonId, input.vehicleId, input.maximumLiters, input.maximumAmount, new Date(input.validFrom), new Date(input.validUntil), input.approvedFuelType, input.singleUse, createHash('sha256').update(token).digest('hex')]
    );
    
    const [rows] = await db.query('SELECT * FROM FuelAuthorization WHERE id = ?', [id]);
    
    await audit(req.auth.tenantId, req.auth.sub, 'FUEL_AUTHORIZATION_CREATED', id);
    res.status(201).json({ authorization: rows[0], qrToken: token });
});
