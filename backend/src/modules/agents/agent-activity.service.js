import { Role } from '../../lib/enums.js';
import db from '../../lib/db.js';
import { randomUUID } from 'node:crypto';

const iso = (value) => value ? new Date(value).toISOString() : undefined;
const amount = (value) => Number(value ?? 0);
const minutesBetween = (from, to) => Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60_000));
const pointTime = (point) => point.deviceRecordedAt ? new Date(point.deviceRecordedAt) : new Date(point.recordedAt);
const distanceMeters = (a, b) => { const radius = 6_371_000; const rad = (value) => value * Math.PI / 180; const dLat = rad(b.latitude - a.latitude); const dLng = rad(b.longitude - a.longitude); const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2; return 2 * radius * Math.asin(Math.sqrt(value)); };
const simplifyPoints = (points, max = 1200) => {
    if (points.length <= max)
        return points;
    const step = (points.length - 1) / (max - 1);
    return Array.from({ length: max }, (_, index) => points[Math.min(points.length - 1, Math.round(index * step))]);
};

export const parseActivityRange = (fromValue, toValue, timezone = 'Asia/Colombo') => {
    const keyPattern = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date().toISOString().slice(0, 10);
    const fromKey = keyPattern.test(String(fromValue ?? '')) ? String(fromValue) : today;
    const toKey = keyPattern.test(String(toValue ?? '')) ? String(toValue) : fromKey;
    if (fromKey > toKey)
        throw new Error('INVALID_ACTIVITY_RANGE');
    const offsetMinutes = timezone === 'Asia/Colombo' ? 330 : 0;
    const boundary = (key) => new Date(new Date(`${key}T00:00:00.000Z`).getTime() - offsetMinutes * 60_000);
    const from = boundary(fromKey);
    const to = boundary(toKey);
    to.setUTCDate(to.getUTCDate() + 1);
    if (from > to || to.getTime() - from.getTime() > 370 * 86_400_000)
        throw new Error('INVALID_ACTIVITY_RANGE');
    return { from, to, fromKey, toKey };
};

export const recordAgentActivity = async (input) => {
    const id = randomUUID();
    const metadataStr = JSON.stringify(input.metadata ?? {});
    
    try {
        await db.query(
            'INSERT INTO AgentActivity (id, tenantId, agentId, eventType, occurredAt, latitude, longitude, entityType, entityId, sourceKey, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, input.tenantId, input.agentId, input.eventType, input.occurredAt, input.latitude ?? null, input.longitude ?? null, input.entityType ?? null, input.entityId ?? null, input.sourceKey, metadataStr]
        );
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            await db.query(
                'UPDATE AgentActivity SET eventType = ?, occurredAt = ?, latitude = ?, longitude = ?, entityType = ?, entityId = ?, metadata = ? WHERE sourceKey = ?',
                [input.eventType, input.occurredAt, input.latitude ?? null, input.longitude ?? null, input.entityType ?? null, input.entityId ?? null, metadataStr, input.sourceKey]
            );
        } else {
            throw error;
        }
    }
};

const ensureAgentAccess = async (agentId, auth) => {
    if (auth.role === Role.AGENT && auth.sub !== agentId)
        return null;
        
    const [agents] = await db.query(
        'SELECT u.id, u.name, u.employeeCode, u.avatarUrl, u.phone, u.email, u.region, p.id as p_id, p.shiftActive, p.trackingState, p.lastLocationAt, p.latitude, p.longitude FROM User u LEFT JOIN AgentProfile p ON u.id = p.userId WHERE u.id = ? AND u.tenantId = ? AND u.role = ? LIMIT 1',
        [agentId, auth.tenantId, Role.AGENT]
    );
    const r = agents[0];
    if (!r) return null;
    
    return {
        id: r.id, name: r.name, employeeCode: r.employeeCode, avatarUrl: r.avatarUrl, phone: r.phone, email: r.email, region: r.region,
        agentProfile: r.p_id ? { id: r.p_id, shiftActive: r.shiftActive, trackingState: r.trackingState, lastLocationAt: r.lastLocationAt, latitude: r.latitude, longitude: r.longitude } : null
    };
};

export const buildAgentActivity = async (agentId, auth, range) => {
    const agent = await ensureAgentAccess(agentId, auth);
    if (!agent)
        return null;
        
    const timeFrom = range.from;
    const timeTo = range.to;
    
    const [[attendances], [locations], [visits], [orders], [invoices], [payments], [assignedShops], [settingsRows], [persistedActivities], [routePlans]] = await Promise.all([
        db.query('SELECT * FROM Attendance WHERE tenantId = ? AND agentId = ? AND checkInAt >= ? AND checkInAt < ? ORDER BY checkInAt ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
        db.query('SELECT * FROM LocationPing WHERE tenantId = ? AND agentId = ? AND ((deviceRecordedAt >= ? AND deviceRecordedAt < ?) OR (deviceRecordedAt IS NULL AND recordedAt >= ? AND recordedAt < ?)) ORDER BY COALESCE(deviceRecordedAt, recordedAt) ASC LIMIT 20000', [auth.tenantId, agentId, timeFrom, timeTo, timeFrom, timeTo]),
        db.query('SELECT v.*, s.id as s_id, s.name as s_name, s.ownerName as s_ownerName, s.phone as s_phone, s.address as s_address, s.city as s_city, s.latitude as s_latitude, s.longitude as s_longitude, s.allowedVisitRadiusMeters as s_allowedVisitRadiusMeters, s.outstandingBalanceLkr as s_outstandingBalanceLkr FROM ShopVisit v JOIN Shop s ON v.shopId = s.id WHERE v.tenantId = ? AND v.agentId = ? AND v.visitedAt >= ? AND v.visitedAt < ? ORDER BY v.visitedAt ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
        db.query('SELECT o.*, p.id as p_id, p.name as p_name, p.sku as p_sku, p.imageUrl as p_imageUrl, i.cases as i_cases, i.totalAmount as i_totalAmount FROM `Order` o LEFT JOIN OrderItem i ON o.id = i.orderId LEFT JOIN Product p ON i.productId = p.id WHERE o.tenantId = ? AND o.agentId = ? AND o.createdAt >= ? AND o.createdAt < ? ORDER BY o.createdAt ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
        db.query('SELECT i.*, o.id as o_id, o.shopId as o_shopId, o.shopName as o_shopName FROM Invoice i JOIN `Order` o ON i.orderId = o.id WHERE i.tenantId = ? AND i.salespersonId = ? AND i.issuedAt >= ? AND i.issuedAt < ? ORDER BY i.issuedAt ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
        db.query('SELECT p.*, i.id as i_id, i.invoiceNumber as i_invoiceNumber, o.shopId as o_shopId, o.id as o_orderId FROM Payment p JOIN Invoice i ON p.invoiceId = i.id JOIN `Order` o ON i.orderId = o.id WHERE p.tenantId = ? AND i.salespersonId = ? AND p.paidAt >= ? AND p.paidAt < ? ORDER BY p.paidAt ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
        db.query('SELECT id, name, latitude, longitude FROM Shop WHERE tenantId = ? AND assignedSalespersonId = ? AND active = ? AND latitude IS NOT NULL AND longitude IS NOT NULL', [auth.tenantId, agentId, true]),
        db.query('SELECT geofenceRadiusMeters, timezone, gpsAccuracyThresholdMeters, gpsUpdateIntervalSeconds, gpsMinimumMovementMeters FROM TenantSettings WHERE tenantId = ?', [auth.tenantId]),
        db.query('SELECT * FROM AgentActivity WHERE tenantId = ? AND agentId = ? AND occurredAt >= ? AND occurredAt < ? ORDER BY occurredAt ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
        db.query('SELECT * FROM AgentRoutePlan WHERE tenantId = ? AND agentId = ? AND date >= ? AND date < ? ORDER BY date ASC', [auth.tenantId, agentId, timeFrom, timeTo]),
    ]);
    
    if (attendances.length > 0) {
        const attendanceIds = attendances.map(a => a.id);
        const placeholders = attendanceIds.map(() => '?').join(',');
        const [breaks] = await db.query(`SELECT * FROM AttendanceBreak WHERE attendanceId IN (${placeholders}) ORDER BY startedAt ASC`, attendanceIds);
        
        const breaksByAttendance = new Map();
        breaks.forEach(b => {
            if (!breaksByAttendance.has(b.attendanceId)) breaksByAttendance.set(b.attendanceId, []);
            breaksByAttendance.get(b.attendanceId).push(b);
        });
        
        attendances.forEach(a => {
            a.breaks = breaksByAttendance.get(a.id) ?? [];
        });
    } else {
        attendances.forEach(a => { a.breaks = []; });
    }
    
    if (visits.length > 0) {
        const visitIds = visits.map(v => v.id);
        const shopIds = visits.map(v => v.shopId);
        const placeholdersVisits = visitIds.map(() => '?').join(',');
        const placeholdersShops = shopIds.map(() => '?').join(',');
        
        const [[visitImages], [shopImages], [shopDocs]] = await Promise.all([
            db.query(`SELECT * FROM ShopVisitImage WHERE shopVisitId IN (${placeholdersVisits}) ORDER BY isPrimary DESC, displayOrder ASC`, visitIds),
            db.query(`SELECT * FROM ShopImage WHERE shopId IN (${placeholdersShops}) ORDER BY isPrimary DESC, displayOrder ASC`, shopIds),
            db.query(`SELECT id, type, shopId FROM ShopDocument WHERE type = 'SHOP_FRONT' AND shopId IN (${placeholdersShops})`, shopIds)
        ]);
        
        const vImagesMap = new Map();
        visitImages.forEach(img => {
            if (!vImagesMap.has(img.shopVisitId)) vImagesMap.set(img.shopVisitId, []);
            vImagesMap.get(img.shopVisitId).push(img);
        });
        
        const sImagesMap = new Map();
        shopImages.forEach(img => {
            if (!sImagesMap.has(img.shopId)) sImagesMap.set(img.shopId, []);
            if (sImagesMap.get(img.shopId).length < 1) sImagesMap.get(img.shopId).push({url: img.url});
        });
        
        const sDocsMap = new Map();
        shopDocs.forEach(doc => {
            if (!sDocsMap.has(doc.shopId)) sDocsMap.set(doc.shopId, []);
            if (sDocsMap.get(doc.shopId).length < 1) sDocsMap.get(doc.shopId).push({id: doc.id, type: doc.type});
        });
        
        visits.forEach(v => {
            v.images = vImagesMap.get(v.id) ?? [];
            v.shop = {
                id: v.s_id, name: v.s_name, ownerName: v.s_ownerName, phone: v.s_phone, address: v.s_address, city: v.s_city, latitude: v.s_latitude, longitude: v.s_longitude, allowedVisitRadiusMeters: v.s_allowedVisitRadiusMeters, outstandingBalanceLkr: v.s_outstandingBalanceLkr,
                images: sImagesMap.get(v.s_id) ?? [], documents: sDocsMap.get(v.s_id) ?? []
            };
        });
    }
    
    const uniqueOrders = new Map();
    orders.forEach(row => {
        if (!uniqueOrders.has(row.id)) {
            uniqueOrders.set(row.id, {
                id: row.id, shopId: row.shopId, shopName: row.shopName, shopVisitId: row.shopVisitId, status: row.status, totalAmountLkr: row.totalAmountLkr, createdAt: new Date(row.createdAt),
                items: []
            });
        }
        if (row.p_id) {
            uniqueOrders.get(row.id).items.push({
                cases: row.i_cases, totalAmount: row.i_totalAmount,
                product: { id: row.p_id, name: row.p_name, sku: row.p_sku, imageUrl: row.p_imageUrl }
            });
        }
    });
    const parsedOrders = Array.from(uniqueOrders.values());
    
    const parsedInvoices = invoices.map(i => ({
        id: i.id, orderId: i.orderId, invoiceNumber: i.invoiceNumber, status: i.status, totalLkr: i.totalLkr, paidLkr: i.paidLkr, issuedAt: new Date(i.issuedAt),
        order: { id: i.o_id, shopId: i.o_shopId, shopName: i.o_shopName }
    }));
    
    const parsedPayments = payments.map(p => ({
        id: p.id, invoiceId: p.invoiceId, amountLkr: p.amountLkr, method: p.method, reference: p.reference, paidAt: new Date(p.paidAt),
        invoice: { id: p.i_id, invoiceNumber: p.i_invoiceNumber, shopId: p.o_shopId, orderId: p.o_orderId }
    }));
    
    const parsedPersistedActivities = persistedActivities.map(a => ({
        ...a, occurredAt: new Date(a.occurredAt), metadata: typeof a.metadata === 'string' ? JSON.parse(a.metadata) : (a.metadata ?? {})
    }));
    
    const settings = settingsRows[0];
    const geofenceRadius = settings?.geofenceRadiusMeters ?? 100;
    
    const visitCandidates = assignedShops.flatMap((shop) => {
        if (shop.latitude == null || shop.longitude == null || visits.some((visit) => visit.shopId === shop.id))
            return [];
        const nearby = locations.filter((point) => distanceMeters(point, { latitude: shop.latitude, longitude: shop.longitude }) <= geofenceRadius);
        if (nearby.length < 2)
            return [];
        const enteredAt = pointTime(nearby[0]);
        const lastSeenAt = pointTime(nearby.at(-1));
        if (lastSeenAt.getTime() - enteredAt.getTime() < 60_000)
            return [];
        return [{ shopId: shop.id, shopName: shop.name, enteredAt: enteredAt.toISOString(), lastSeenAt: lastSeenAt.toISOString(), durationMinutes: minutesBetween(enteredAt, lastSeenAt), latitude: shop.latitude, longitude: shop.longitude, status: 'POSSIBLE_VISIT', message: 'GPS geofence presence only. Salesperson check-in, check-out, order, invoice, payment, or explicit action is required to confirm this visit.' }];
    });
    
    const visitCards = visits.map((visit, index) => {
        const visitEnd = visit.departedAt ? new Date(visit.departedAt) : new Date(Math.min(range.to.getTime(), Date.now()));
        const linkedOrders = parsedOrders.filter((order) => order.shopVisitId === visit.id || order.shopId === visit.shopId && order.createdAt >= new Date(visit.visitedAt) && order.createdAt <= visitEnd);
        const linkedInvoices = parsedInvoices.filter((invoice) => linkedOrders.some((order) => order.id === invoice.orderId));
        const linkedPayments = parsedPayments.filter((payment) => linkedInvoices.some((invoice) => invoice.id === payment.invoiceId));
        return {
            id: visit.id, sequence: index + 1, shopId: visit.shopId, shopName: visit.shop.name,
            address: `${visit.shop.address}, ${visit.shop.city}`, arrivalAt: iso(visit.visitedAt), departureAt: iso(visit.departedAt),
            durationMinutes: visit.durationMinutes ?? minutesBetween(visit.visitedAt, visit.departedAt),
            latitude: visit.latitude, longitude: visit.longitude, accuracy: visit.accuracy,
            gpsVerified: !visit.outsideRetailerLocation, distanceFromShopMeters: visit.distanceFromShopMeters,
            geofenceExceptionReason: visit.geofenceExceptionReason, geofenceExceptionNote: visit.geofenceExceptionNote, geofenceExceptionStatus: visit.geofenceExceptionStatus,
            checkoutLatitude: visit.checkoutLatitude, checkoutLongitude: visit.checkoutLongitude, checkoutAccuracy: visit.checkoutAccuracy,
            contactPerson: visit.shop.ownerName, phone: visit.shop.phone, allowedRadiusMeters: visit.shop.allowedVisitRadiusMeters ?? geofenceRadius, outstandingBalanceLkr: amount(visit.shop.outstandingBalanceLkr), followUpRequired: visit.followUpRequired, visitStatus: visit.visitStatus,
            notes: visit.notes, purpose: visit.purpose, productsDiscussed: visit.productsDiscussed, orderCreated: visit.orderCreated || linkedOrders.length > 0,
            shopImageAvailable: visit.shop.images.length > 0 || visit.shop.documents.length > 0,
            shopImageUrl: visit.images[0]?.url ?? visit.shop.images[0]?.url,
            images: visit.images,
            orders: linkedOrders.map((order) => ({ id: order.id, status: order.status, totalLkr: amount(order.totalAmountLkr), createdAt: iso(order.createdAt), products: order.items.map((item) => ({ id: item.product.id, name: item.product.name, sku: item.product.sku, cases: item.cases, totalLkr: amount(item.totalAmount) })) })),
            invoices: linkedInvoices.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, status: invoice.status, totalLkr: amount(invoice.totalLkr), paidLkr: amount(invoice.paidLkr), issuedAt: iso(invoice.issuedAt) })),
            payments: linkedPayments.map((payment) => ({ id: payment.id, amountLkr: amount(payment.amountLkr), method: payment.method, reference: payment.reference, paidAt: iso(payment.paidAt) })),
            salesLkr: linkedOrders.reduce((sum, order) => sum + amount(order.totalAmountLkr), 0),
            collectedLkr: linkedPayments.reduce((sum, payment) => sum + amount(payment.amountLkr), 0),
            paymentStatus: linkedInvoices.length ? linkedInvoices.every((invoice) => invoice.status === 'PAID') ? 'PAID' : linkedInvoices.some((invoice) => invoice.status === 'PARTIAL') ? 'PARTIAL' : linkedInvoices[0].status : 'NO_INVOICE',
        };
    });
    
    const events = [];
    attendances.forEach((attendance) => {
        events.push({ id: `attendance-in-${attendance.id}`, at: new Date(attendance.checkInAt).toISOString(), type: 'PUNCH_IN', title: 'Punch In', detail: attendance.checkInLat == null ? undefined : `${attendance.checkInLat.toFixed(6)}, ${attendance.checkInLng?.toFixed(6)}` });
        attendance.breaks.forEach((entry) => { events.push({ id: `break-start-${entry.id}`, at: new Date(entry.startedAt).toISOString(), type: 'BREAK_START', title: 'Break started' }); if (entry.endedAt)
            events.push({ id: `break-end-${entry.id}`, at: new Date(entry.endedAt).toISOString(), type: 'BREAK_END', title: 'Break ended' }); });
        if (attendance.checkOutAt)
            events.push({ id: `attendance-out-${attendance.id}`, at: new Date(attendance.checkOutAt).toISOString(), type: 'PUNCH_OUT', title: 'Punch Out' });
    });
    
    const moving = locations.find((point) => amount(point.speedKmH) >= 3 || point.segmentDistanceMeters >= 20);
    if (moving)
        events.push({ id: `travel-${moving.id}`, at: pointTime(moving).toISOString(), type: 'TRAVEL_STARTED', title: 'Started travelling' });
        
    visitCards.forEach((visit) => {
        events.push({ id: `visit-arrive-${visit.id}`, at: visit.arrivalAt, type: 'SHOP_ARRIVAL', title: `Arrived at ${visit.shopName}`, detail: visit.gpsVerified ? 'GPS verified' : 'GPS requires review', shopId: visit.shopId, entityId: visit.id });
        events.push({ id: `visit-in-${visit.id}`, at: visit.arrivalAt, type: 'SHOP_CHECK_IN', title: `Shop check-in · ${visit.shopName}`, shopId: visit.shopId, entityId: visit.id });
        if (visit.departureAt) {
            events.push({ id: `visit-out-${visit.id}`, at: visit.departureAt, type: 'SHOP_CHECK_OUT', title: `Shop check-out · ${visit.shopName}`, detail: `${visit.durationMinutes} minutes`, shopId: visit.shopId, entityId: visit.id });
            events.push({ id: `visit-left-${visit.id}`, at: visit.departureAt, type: 'SHOP_DEPARTURE', title: `Left ${visit.shopName}`, shopId: visit.shopId, entityId: visit.id });
        }
    });
    
    parsedOrders.forEach((order) => events.push({ id: `order-${order.id}`, at: order.createdAt.toISOString(), type: 'ORDER_CREATED', title: `Order created · ${order.shopName}`, detail: `LKR ${amount(order.totalAmountLkr).toLocaleString()}`, shopId: order.shopId ?? undefined, entityId: order.id }));
    parsedInvoices.forEach((invoice) => events.push({ id: `invoice-${invoice.id}`, at: invoice.issuedAt.toISOString(), type: 'INVOICE_CREATED', title: `Invoice created · ${invoice.invoiceNumber}`, detail: `LKR ${amount(invoice.totalLkr).toLocaleString()}`, shopId: invoice.order.shopId ?? undefined, entityId: invoice.id }));
    parsedPayments.forEach((payment) => events.push({ id: `payment-${payment.id}`, at: payment.paidAt.toISOString(), type: 'PAYMENT_COLLECTED', title: 'Payment collected', detail: `LKR ${amount(payment.amountLkr).toLocaleString()} · ${payment.method}`, shopId: payment.invoice.shopId ?? undefined, entityId: payment.id }));
    
    parsedPersistedActivities.forEach((activity) => { if (!events.some(event => event.type === activity.eventType && event.entityId === activity.entityId))
        events.push({ id: activity.id, at: activity.occurredAt.toISOString(), type: activity.eventType, title: String(activity.metadata?.title ?? activity.eventType.replaceAll('_', ' ')), detail: String(activity.metadata?.detail ?? ''), entityId: activity.entityId ?? undefined }); });
        
    events.sort((a, b) => a.at.localeCompare(b.at));
    
    const dayKeys = [];
    for (let cursor = new Date(range.from); cursor < range.to; cursor.setUTCDate(cursor.getUTCDate() + 1))
        dayKeys.push(cursor.toISOString().slice(0, 10));
        
    const daily = dayKeys.map((date, index) => {
        const start = new Date(range.from.getTime() + index * 86_400_000);
        const end = new Date(start.getTime() + 86_400_000);
        const dayAttendance = attendances.filter((row) => new Date(row.checkInAt) >= start && new Date(row.checkInAt) < end);
        const dayVisits = visitCards.filter((row) => new Date(row.arrivalAt) >= start && new Date(row.arrivalAt) < end);
        const dayOrders = parsedOrders.filter((row) => row.createdAt >= start && row.createdAt < end);
        const dayPayments = parsedPayments.filter((row) => row.paidAt >= start && row.paidAt < end);
        return { date, worked: dayAttendance.length > 0, workingMinutes: dayAttendance.reduce((sum, row) => sum + Math.max(0, minutesBetween(row.checkInAt, row.checkOutAt) - row.breaks.reduce((total, item) => total + minutesBetween(item.startedAt, item.endedAt), 0)), 0), visits: dayVisits.length, uniqueShops: new Set(dayVisits.map((row) => row.shopId)).size, orders: dayOrders.length, salesLkr: dayOrders.filter((row) => row.status !== 'CANCELLED').reduce((sum, row) => sum + amount(row.totalAmountLkr), 0), collectionsLkr: dayPayments.reduce((sum, row) => sum + amount(row.amountLkr), 0), distanceKm: dayAttendance.reduce((sum, row) => sum + row.distanceKm, 0), averageVisitMinutes: dayVisits.length ? Math.round(dayVisits.reduce((sum, row) => sum + row.durationMinutes, 0) / dayVisits.length) : 0 };
    });
    
    const totalSales = daily.reduce((sum, row) => sum + row.salesLkr, 0);
    const totalCollections = daily.reduce((sum, row) => sum + row.collectionsLkr, 0);
    const periodMs = range.to.getTime() - range.from.getTime();
    const previousFrom = new Date(range.from.getTime() - periodMs);
    const previousTo = range.from;
    
    const [previousSales] = await db.query(
        'SELECT SUM(totalAmountLkr) as sumSales FROM `Order` WHERE tenantId = ? AND agentId = ? AND createdAt >= ? AND createdAt < ? AND status != ?',
        [auth.tenantId, agentId, previousFrom, previousTo, 'CANCELLED']
    );
    const previousSalesLkr = amount(previousSales[0]?.sumSales);
    
    const shopPerformance = new Map();
    parsedOrders.filter((order) => order.status !== 'CANCELLED').forEach((order) => { const id = order.shopId ?? order.shopName; const current = shopPerformance.get(id) ?? { shopId: order.shopId ?? undefined, shopName: order.shopName, orders: 0, salesLkr: 0 }; current.orders += 1; current.salesLkr += amount(order.totalAmountLkr); shopPerformance.set(id, current); });
    
    const currentVisit = visitCards.find((visit) => !visit.departureAt);
    const lastPoint = locations.at(-1);
    
    let selectedPlan = undefined;
    if (range.fromKey === range.toKey && routePlans.length > 0) {
        selectedPlan = routePlans[0];
        const [stopsRows] = await db.query('SELECT rs.*, s.id as s_id, s.name as s_name, s.address as s_address, s.city as s_city, s.phone as s_phone, s.latitude as s_latitude, s.longitude as s_longitude, s.allowedVisitRadiusMeters as s_allowedVisitRadiusMeters, s.outstandingBalanceLkr as s_outstandingBalanceLkr, cv.id as cv_id FROM AgentRouteStop rs LEFT JOIN Shop s ON rs.shopId = s.id LEFT JOIN ShopVisit cv ON rs.completedVisitId = cv.id WHERE rs.routePlanId = ? ORDER BY rs.sequence ASC', [selectedPlan.id]);
        selectedPlan.stops = stopsRows.map(r => ({
            ...r,
            shop: { id: r.s_id, name: r.s_name, address: r.s_address, city: r.s_city, phone: r.s_phone, latitude: r.s_latitude, longitude: r.s_longitude, allowedVisitRadiusMeters: r.s_allowedVisitRadiusMeters, outstandingBalanceLkr: r.s_outstandingBalanceLkr },
            completedVisit: r.cv_id ? { id: r.cv_id } : null
        }));
    }
    
    const completedStopIds = new Set(visits.map(visit => visit.routeStopId).filter(Boolean));
    const plannedShopIds = new Set(selectedPlan?.stops.map(stop => stop.shopId) ?? []);
    const completedStops = selectedPlan?.stops.filter(stop => stop.completedVisit || completedStopIds.has(stop.id) || stop.status === 'VISITED') ?? [];
    const missedStops = selectedPlan?.stops.filter(stop => stop.status === 'MISSED') ?? [];
    const pendingStops = selectedPlan?.stops.filter(stop => !completedStops.includes(stop) && stop.status === 'PENDING') ?? [];
    const unplannedVisits = visitCards.filter(visit => !plannedShopIds.has(visit.shopId));
    const routeCompletionPercent = selectedPlan?.stops.length ? Math.round(completedStops.length / selectedPlan.stops.length * 100) : 0;
    const target = selectedPlan ? amount(selectedPlan.salesTargetLkr) : 0;
    const collectionTarget = selectedPlan ? amount(selectedPlan.collectionTargetLkr) : 0;
    const productiveVisits = visitCards.filter(visit => visit.orderCreated || visit.collectedLkr > 0);
    const retainedLocations = locations.filter(point => point.retainedForDistance);
    const routePoints = simplifyPoints(retainedLocations).map((point) => ({ latitude: point.latitude, longitude: point.longitude, capturedAt: pointTime(point).toISOString(), accuracy: point.accuracy, speedKmH: point.speedKmH }));
    const latestBreak = attendances.flatMap(row => row.breaks).at(-1);
    const now = new Date();
    
    return {
        agent: { ...agent, currentStatus: currentVisit ? 'On Visit' : agent.agentProfile?.shiftActive ? 'Working' : 'Offline' },
        range: { from: range.fromKey, to: range.toKey, days: dayKeys.length },
        serverNow: now.toISOString(), timezone: settings?.timezone ?? 'UTC',
        status: { working: agent.agentProfile?.shiftActive ?? false, trackingState: agent.agentProfile?.trackingState ?? 'STOPPED', lastGpsAt: iso(agent.agentProfile?.lastLocationAt), lastSyncAt: iso(locations.at(-1)?.recordedAt), onBreak: Boolean(latestBreak && !latestBreak.endedAt) },
        kpis: {
            currentStatus: currentVisit ? 'On Visit' : agent.agentProfile?.shiftActive ? 'Working' : 'Offline',
            punchIn: iso(attendances[0]?.checkInAt), punchOut: iso(attendances.at(-1)?.checkOutAt),
            workingMinutes: daily.reduce((sum, row) => sum + row.workingMinutes, 0),
            currentLocation: lastPoint ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude, at: pointTime(lastPoint).toISOString() } : agent.agentProfile?.latitude == null ? null : { latitude: agent.agentProfile.latitude, longitude: agent.agentProfile.longitude, at: iso(agent.agentProfile.lastLocationAt) },
            shopsVisited: visitCards.length, uniqueShops: new Set(visitCards.map((visit) => visit.shopId)).size,
            orders: parsedOrders.length, totalSalesLkr: totalSales, paymentCollectionsLkr: totalCollections,
            distanceKm: Number(daily.reduce((sum, row) => sum + row.distanceKm, 0).toFixed(2)),
        },
        route: {
            points: routePoints, rawPointCount: locations.length, retainedPointCount: retainedLocations.length,
            start: locations[0] ? { latitude: locations[0].latitude, longitude: locations[0].longitude, at: pointTime(locations[0]).toISOString() } : attendances[0]?.checkInLat == null ? null : { latitude: attendances[0].checkInLat, longitude: attendances[0].checkInLng, at: new Date(attendances[0].checkInAt).toISOString() },
            end: lastPoint ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude, at: pointTime(lastPoint).toISOString() } : attendances.at(-1)?.checkOutLat == null ? null : { latitude: attendances.at(-1).checkOutLat, longitude: attendances.at(-1).checkOutLng, at: new Date(attendances.at(-1).checkOutAt).toISOString() },
        },
        timeline: events, visits: visitCards, visitCandidates,
        targets: { shops: selectedPlan?.stops.length ?? 0, salesLkr: target, collectionsLkr: collectionTarget },
        progress: { shopsPercent: routeCompletionPercent, salesPercent: target ? Math.min(100, Math.round(totalSales / target * 100)) : 0, collectionsPercent: collectionTarget ? Math.min(100, Math.round(totalCollections / collectionTarget * 100)) : 0, routePercent: routeCompletionPercent },
        routePlan: selectedPlan ? { id: selectedPlan.id, date: new Date(selectedPlan.date).toISOString(), territory: selectedPlan.territory, startLabel: selectedPlan.startLabel, startLatitude: selectedPlan.startLatitude, startLongitude: selectedPlan.startLongitude, plannedDistanceKm: selectedPlan.plannedDistanceKm, status: selectedPlan.status, stops: selectedPlan.stops.map(stop => ({ ...stop, shop: { ...stop.shop, outstandingBalanceLkr: amount(stop.shop.outstandingBalanceLkr) } })) } : null,
        routeComparison: { plannedShops: selectedPlan?.stops.length ?? 0, completedShops: completedStops.length, missedShops: missedStops.length, unplannedShops: unplannedVisits.length, plannedDistanceKm: selectedPlan?.plannedDistanceKm ?? 0, actualDistanceKm: Number(daily.reduce((sum, row) => sum + row.distanceKm, 0).toFixed(2)), deviationKm: Number(Math.abs((selectedPlan?.plannedDistanceKm ?? 0) - daily.reduce((sum, row) => sum + row.distanceKm, 0)).toFixed(2)), completionPercent: routeCompletionPercent },
        quality: { gpsVerifiedVisits: visitCards.filter(visit => visit.gpsVerified).length, averageVisitMinutes: visitCards.length ? Math.round(visitCards.reduce((sum, visit) => sum + visit.durationMinutes, 0) / visitCards.length) : 0, productiveVisits: productiveVisits.length, noSaleVisits: visitCards.length - productiveVisits.length, ordersPerVisit: visitCards.length ? Number((parsedOrders.length / visitCards.length).toFixed(1)) : 0, collectionsPerVisit: visitCards.length ? Number((totalCollections / visitCards.length).toFixed(0)) : 0, followUpsRequired: visitCards.filter(visit => visit.followUpRequired).length },
        nextAction: pendingStops[0] ? { routeStopId: pendingStops[0].id, shop: pendingStops[0].shop, plannedArrivalTime: iso(pendingStops[0].plannedArrivalTime) } : null,
        breaks: attendances.flatMap(row => row.breaks.map(item => ({ id: item.id, startedAt: new Date(item.startedAt).toISOString(), endedAt: iso(item.endedAt), durationMinutes: minutesBetween(item.startedAt, item.endedAt), active: !item.endedAt }))),
        sales: { orders: parsedOrders.map((order) => ({ id: order.id, shopId: order.shopId, shopName: order.shopName, status: order.status, totalLkr: amount(order.totalAmountLkr), createdAt: iso(order.createdAt) })), invoices: parsedInvoices.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, orderId: invoice.orderId, status: invoice.status, totalLkr: amount(invoice.totalLkr), paidLkr: amount(invoice.paidLkr), issuedAt: iso(invoice.issuedAt) })), payments: parsedPayments.map((payment) => ({ id: payment.id, invoiceId: payment.invoiceId, amountLkr: amount(payment.amountLkr), method: payment.method, reference: payment.reference, paidAt: iso(payment.paidAt) })) },
        performance: { daily, workingDays: daily.filter((row) => row.worked).length, attendance: { presentDays: attendances.length, lateDays: attendances.filter((row) => row.status === 'LATE').length, absentDays: Math.max(0, dayKeys.length - attendances.length) }, totalVisits: visitCards.length, totalOrders: parsedOrders.length, totalSalesLkr: totalSales, collectionsLkr: totalCollections, distanceKm: Number(daily.reduce((sum, row) => sum + row.distanceKm, 0).toFixed(2)), averageVisitMinutes: visitCards.length ? Math.round(visitCards.reduce((sum, row) => sum + row.durationMinutes, 0) / visitCards.length) : 0, averageShopsPerDay: Number((visitCards.length / Math.max(1, daily.filter((row) => row.worked).length)).toFixed(1)), targetAchievementPercent: target ? Number((totalSales / target * 100).toFixed(1)) : null, topShops: [...shopPerformance.values()].sort((a, b) => b.salesLkr - a.salesLkr).slice(0, 5), bestSalesDay: [...daily].sort((a, b) => b.salesLkr - a.salesLkr)[0] ?? null, previousPeriodSalesLkr: previousSalesLkr, salesTrendPercent: previousSalesLkr ? Number(((totalSales - previousSalesLkr) / previousSalesLkr * 100).toFixed(1)) : totalSales ? 100 : 0 },
    };
};
