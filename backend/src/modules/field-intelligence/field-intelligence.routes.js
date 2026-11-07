import { Role, RoutePlanStatus } from '../../lib/enums.js';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import db from '../../lib/db.js';
import { buildAgentActivity, parseActivityRange } from '../agents/agent-activity.service.js';
import { randomUUID } from 'node:crypto';

export const fieldIntelligenceRouter = Router();
fieldIntelligenceRouter.use(authenticate, authorize(Role.ADMIN, Role.MANAGER));

const dayRange = async (tenantId, value) => {
    const [settings] = await db.query('SELECT timezone, geofenceRadiusMeters FROM TenantSettings WHERE tenantId = ?', [tenantId]);
    return { range: parseActivityRange(value, value, settings[0]?.timezone), geofenceRadiusMeters: settings[0]?.geofenceRadiusMeters ?? 100 };
};

const amount = (value) => Number(value ?? 0);
const minutes = (start, end) => start ? Math.max(0, Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 60_000)) : 0;

fieldIntelligenceRouter.get('/', async (req, res) => {
    let date;
    try {
        date = await dayRange(req.auth.tenantId, req.query.date);
    } catch {
        return res.status(422).json({ error: { code: 'INVALID_DATE', message: 'Use a valid YYYY-MM-DD date.' } });
    }
    const { range } = date;
    
    let uQuery = 'SELECT u.id, u.name, u.avatarUrl, u.employeeCode, u.region FROM User u WHERE u.tenantId = ? AND u.role = ?';
    const uParams = [req.auth.tenantId, Role.AGENT];
    
    uQuery += ' AND (EXISTS (SELECT 1 FROM Attendance a WHERE a.agentId = u.id AND a.checkInAt >= ? AND a.checkInAt < ?) OR EXISTS (SELECT 1 FROM AgentRoutePlan arp WHERE arp.agentId = u.id AND arp.date = ?))';
    uParams.push(range.from, range.to, range.from);
    
    if (req.query.search) {
        const s = `%${req.query.search}%`;
        uQuery += ' AND (u.name LIKE ? OR EXISTS (SELECT 1 FROM AgentRoutePlan arp JOIN RouteStop rs ON arp.id = rs.planId JOIN Shop s ON rs.shopId = s.id WHERE arp.agentId = u.id AND arp.date = ? AND s.name LIKE ?))';
        uParams.push(s, range.from, s);
    }
    
    if (req.query.territory) {
        const t = String(req.query.territory);
        uQuery += ' AND (u.region = ? OR EXISTS (SELECT 1 FROM AgentProfile ap WHERE ap.userId = u.id AND ap.routeAssigned = ?) OR EXISTS (SELECT 1 FROM AgentRoutePlan arp WHERE arp.agentId = u.id AND arp.date = ? AND arp.territory = ?))';
        uParams.push(t, t, range.from, t);
    }
    
    if (req.query.routeStatus && req.query.routeStatus !== 'DEVIATED') {
        uQuery += ' AND EXISTS (SELECT 1 FROM AgentRoutePlan arp WHERE arp.agentId = u.id AND arp.date = ? AND arp.status = ?)';
        uParams.push(range.from, req.query.routeStatus);
    }
    
    if (req.query.visitStatus) {
        if (req.query.visitStatus === 'FOLLOW_UP') {
            uQuery += ' AND EXISTS (SELECT 1 FROM AgentRoutePlan arp JOIN RouteStop rs ON arp.id = rs.planId JOIN ShopVisit sv ON rs.completedVisitId = sv.id WHERE arp.agentId = u.id AND arp.date = ? AND sv.followUpRequired = ?)';
            uParams.push(range.from, true);
        } else {
            uQuery += ' AND EXISTS (SELECT 1 FROM AgentRoutePlan arp JOIN RouteStop rs ON arp.id = rs.planId WHERE arp.agentId = u.id AND arp.date = ? AND rs.status = ?)';
            uParams.push(range.from, req.query.visitStatus);
        }
    }
    
    uQuery += ' ORDER BY u.name ASC';
    
    let pQuery = 'SELECT * FROM AgentRoutePlan WHERE tenantId = ? AND date = ?';
    const pParams = [req.auth.tenantId, range.from];
    
    if (req.query.routeStatus && req.query.routeStatus !== 'DEVIATED') {
        pQuery += ' AND status = ?';
        pParams.push(req.query.routeStatus);
    }
    
    const [[agents], [plansRows]] = await Promise.all([
        db.query(uQuery, uParams),
        db.query(pQuery, pParams)
    ]);
    
    let plans = plansRows.map(p => ({ ...p, stops: [] }));
    if (plans.length > 0) {
        const planIds = plans.map(p => p.id);
        const placeholders = planIds.map(() => '?').join(',');
        
        const [stopsRows] = await db.query(
            `SELECT rs.*, s.id as s_id, s.name as s_name, s.address as s_address, s.city as s_city, s.latitude as s_lat, s.longitude as s_lng, s.outstandingBalanceLkr as s_bal, s.allowedVisitRadiusMeters as s_rad, sv.id as sv_id, sv.visitedAt as sv_visitedAt, sv.departedAt as sv_departedAt, sv.durationMinutes as sv_durationMinutes, sv.notes as sv_notes, sv.followUpRequired as sv_followUpRequired, sv.gpsVerified as sv_gpsVerified, sv.distanceFromShopMeters as sv_distanceFromShopMeters FROM RouteStop rs JOIN Shop s ON rs.shopId = s.id LEFT JOIN ShopVisit sv ON rs.completedVisitId = sv.id WHERE rs.planId IN (${placeholders}) ORDER BY rs.sequence ASC`,
            planIds
        );
        
        const stopsMap = new Map();
        stopsRows.forEach(rs => {
            if (!stopsMap.has(rs.planId)) stopsMap.set(rs.planId, []);
            
            const stopObj = {
                id: rs.id, planId: rs.planId, shopId: rs.shopId, sequence: rs.sequence, plannedArrivalTime: rs.plannedArrivalTime, status: rs.status, completedVisitId: rs.completedVisitId,
                shop: { id: rs.s_id, name: rs.s_name, address: rs.s_address, city: rs.s_city, latitude: rs.s_lat, longitude: rs.s_lng, outstandingBalanceLkr: rs.s_bal, allowedVisitRadiusMeters: rs.s_rad },
                completedVisit: rs.sv_id ? { id: rs.sv_id, visitedAt: rs.sv_visitedAt, departedAt: rs.sv_departedAt, durationMinutes: rs.sv_durationMinutes, notes: rs.sv_notes, followUpRequired: rs.sv_followUpRequired, gpsVerified: rs.sv_gpsVerified, distanceFromShopMeters: rs.sv_distanceFromShopMeters } : null
            };
            
            stopsMap.get(rs.planId).push(stopObj);
        });
        
        plans.forEach(p => { p.stops = stopsMap.get(p.id) ?? []; });
    }

    const selectedAgentId = req.query.agentId ? String(req.query.agentId) : undefined;
    const reports = await Promise.all(agents.map(agent => buildAgentActivity(agent.id, req.auth, range)));

    const team = agents.map((agent, index) => {
        const report = reports[index];
        const plan = plans.find(row => row.agentId === agent.id);
        const assigned = plan?.stops.length ?? 0;
        const completed = plan ? plan.stops.filter(stop => stop.completedVisit || stop.status === 'VISITED').length : report?.kpis.uniqueShops ?? 0;
        const currentVisit = report?.visits.find(visit => !visit.departureAt);
        const latest = report?.route.points.at(-1);
        const travelling = !currentVisit && latest && Number(latest.speedKmH ?? 0) >= 3;
        return {
            ...agent,
            status: currentVisit ? 'ON_VISIT' : travelling ? 'TRAVELLING' : report?.agent.currentStatus === 'Offline' ? 'OFFLINE' : 'ONLINE',
            startTime: report?.kpis.punchIn, assignedShops: assigned || report?.kpis.uniqueShops || 0, completedVisits: completed,
            remainingVisits: Math.max(0, assigned - completed), routeCompletionPercent: assigned ? Math.round(completed / assigned * 100) : 0,
            salesLkr: report?.kpis.totalSalesLkr ?? 0, distanceKm: report?.kpis.distanceKm ?? 0,
            lastGpsAt: latest?.capturedAt ?? report?.kpis.currentLocation?.at, currentLocation: report?.kpis.currentLocation,
        };
    });

    const selectedReport = selectedAgentId ? reports[agents.findIndex(agent => agent.id === selectedAgentId)] ?? await buildAgentActivity(selectedAgentId, req.auth, range) : null;
    const selectedPlan = selectedAgentId ? plans.find(plan => plan.agentId === selectedAgentId) : undefined;
    const plannedStops = selectedPlan?.stops.map(stop => ({
        id: stop.id, sequence: stop.sequence, status: stop.completedVisit ? 'VISITED' : stop.status,
        plannedArrivalTime: stop.plannedArrivalTime ? new Date(stop.plannedArrivalTime).toISOString() : null, shop: { ...stop.shop, outstandingBalanceLkr: amount(stop.shop.outstandingBalanceLkr) },
    })) ?? [];

    const visitedShopIds = new Set(selectedReport?.visits.map(visit => visit.shopId));
    const plannedShopIds = new Set(plannedStops.map(stop => stop.shop.id));
    const unplannedVisits = selectedReport?.visits.filter(visit => !plannedShopIds.has(visit.shopId)) ?? [];
    const completed = plannedStops.filter(stop => visitedShopIds.has(stop.shop.id) || stop.status === 'VISITED').length;
    const actualDistanceKm = selectedReport?.kpis.distanceKm ?? 0;
    const plannedDistanceKm = selectedPlan?.plannedDistanceKm ?? 0;

    const alerts = selectedReport ? [
        ...plannedStops.filter(stop => stop.status === 'MISSED').map(stop => ({ id: `missed-${stop.id}`, type: 'MISSED_SHOP', severity: 'warning', message: `${stop.shop.name} was missed.` })),
        ...selectedReport.visits.filter(visit => !visit.gpsVerified).map(visit => ({ id: `gps-${visit.id}`, type: 'OUTSIDE_SHOP', severity: 'warning', message: `${visit.shopName} check-in was outside its allowed radius.` })),
        ...selectedReport.visits.filter(visit => visit.durationMinutes < 5).map(visit => ({ id: `short-${visit.id}`, type: 'SHORT_VISIT', severity: 'info', message: `${visit.shopName} visit lasted ${visit.durationMinutes} minutes.` })),
        ...selectedReport.visits.filter(visit => !visit.orderCreated).map(visit => ({ id: `nosale-${visit.id}`, type: 'NO_SALE', severity: 'info', message: `${visit.shopName} was completed without an order.` })),
    ] : [];

    const productive = selectedReport?.visits.filter(visit => visit.orderCreated || visit.collectedLkr > 0) ?? [];

    return res.json({
        date: range.fromKey, team,
        teamKpis: { activeAgents: team.filter(agent => agent.status !== 'OFFLINE').length, assignedShops: team.reduce((sum, agent) => sum + agent.assignedShops, 0), completedVisits: team.reduce((sum, agent) => sum + agent.completedVisits, 0), salesLkr: team.reduce((sum, agent) => sum + agent.salesLkr, 0), distanceKm: Number(team.reduce((sum, agent) => sum + agent.distanceKm, 0).toFixed(2)) },
        selected: selectedReport ? {
            report: selectedReport,
            plan: selectedPlan ? { id: selectedPlan.id, status: selectedPlan.status, territory: selectedPlan.territory, startLabel: selectedPlan.startLabel, startLatitude: selectedPlan.startLatitude, startLongitude: selectedPlan.startLongitude, plannedDistanceKm, stops: plannedStops } : null,
            comparison: { completionPercent: plannedStops.length ? Math.round(completed / plannedStops.length * 100) : 0, plannedDistanceKm, actualDistanceKm, deviationKm: Number(Math.abs(actualDistanceKm - plannedDistanceKm).toFixed(2)), missedShops: plannedStops.filter(stop => stop.status === 'MISSED'), unplannedVisits, remainingShops: plannedStops.filter(stop => !visitedShopIds.has(stop.shop.id) && stop.status === 'PENDING') },
            performance: { productiveVisits: productive.length, noSaleVisits: selectedReport.visits.length - productive.length, productiveVisitMinutes: productive.reduce((sum, visit) => sum + visit.durationMinutes, 0), gpsVerifiedVisits: selectedReport.visits.filter(visit => visit.gpsVerified).length, averageVisitMinutes: selectedReport.performance.averageVisitMinutes },
            alerts,
        } : null,
    });
});

fieldIntelligenceRouter.get('/agents/:agentId/replay', async (req, res) => {
    let date;
    try {
        date = await dayRange(req.auth.tenantId, req.query.date);
    } catch {
        return res.status(422).json({ error: { code: 'INVALID_DATE' } });
    }
    const report = await buildAgentActivity(String(req.params.agentId), req.auth, date.range);
    if (!report)
        return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND' } });
    return res.json({ points: report.route.points, events: report.timeline });
});

const planInput = z.object({
    agentId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), territory: z.string().max(120).optional(),
    startLabel: z.string().max(160).optional(), startLatitude: z.number().min(-90).max(90).optional(), startLongitude: z.number().min(-180).max(180).optional(),
    plannedDistanceKm: z.number().min(0).default(0), status: z.nativeEnum(RoutePlanStatus).default(RoutePlanStatus.DRAFT),
    salesTargetLkr: z.number().nonnegative().default(0), collectionTargetLkr: z.number().nonnegative().default(0),
    stops: z.array(z.object({ shopId: z.string().min(1), plannedArrivalTime: z.string().datetime().optional() })).min(1),
});

fieldIntelligenceRouter.post('/route-plans', async (req, res) => {
    const input = planInput.parse(req.body);
    const { range } = await dayRange(req.auth.tenantId, input.date);
    
    const shopIds = [...new Set(input.stops.map(stop => stop.shopId))];
    const placeholders = shopIds.map(() => '?').join(',');
    
    const [[agents], [shopsRow]] = await Promise.all([
        db.query('SELECT id FROM User WHERE id = ? AND tenantId = ? AND role = ?', [input.agentId, req.auth.tenantId, Role.AGENT]),
        db.query(`SELECT COUNT(DISTINCT id) as c FROM Shop WHERE id IN (${placeholders}) AND tenantId = ? AND active = ?`, [...shopIds, req.auth.tenantId, true]),
    ]);
    
    if (agents.length === 0 || shopsRow[0].c !== shopIds.length)
        return res.status(422).json({ error: { code: 'INVALID_ROUTE_ASSIGNMENT' } });
        
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let plan;
    try {
        const [existing] = await connection.query('SELECT id FROM AgentRoutePlan WHERE agentId = ? AND date = ?', [input.agentId, range.from]);
        
        const planId = existing.length > 0 ? existing[0].id : randomUUID();
        
        if (existing.length > 0) {
            await connection.query(
                'UPDATE AgentRoutePlan SET territory = ?, startLabel = ?, startLatitude = ?, startLongitude = ?, plannedDistanceKm = ?, salesTargetLkr = ?, collectionTargetLkr = ?, status = ?, updatedAt = NOW() WHERE id = ?',
                [input.territory || null, input.startLabel || null, input.startLatitude || null, input.startLongitude || null, input.plannedDistanceKm, input.salesTargetLkr, input.collectionTargetLkr, input.status, planId]
            );
            await connection.query('DELETE FROM RouteStop WHERE planId = ?', [planId]);
        } else {
            await connection.query(
                'INSERT INTO AgentRoutePlan (id, tenantId, agentId, date, territory, startLabel, startLatitude, startLongitude, plannedDistanceKm, salesTargetLkr, collectionTargetLkr, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                [planId, req.auth.tenantId, input.agentId, range.from, input.territory || null, input.startLabel || null, input.startLatitude || null, input.startLongitude || null, input.plannedDistanceKm, input.salesTargetLkr, input.collectionTargetLkr, input.status]
            );
        }
        
        if (input.stops.length > 0) {
            for (let i = 0; i < input.stops.length; i++) {
                const stop = input.stops[i];
                await connection.query(
                    'INSERT INTO RouteStop (id, tenantId, planId, shopId, sequence, plannedArrivalTime) VALUES (?, ?, ?, ?, ?)',
                    [req.auth.tenantId, planId, stop.shopId, i + 1, stop.plannedArrivalTime ? new Date(stop.plannedArrivalTime) : null]
                );
            }
        }
        
        const [plansRows] = await connection.query('SELECT * FROM AgentRoutePlan WHERE id = ?', [planId]);
        plan = { ...plansRows[0], stops: [] };
        
        const [stopsRows] = await connection.query(
            'SELECT rs.*, s.id as s_id, s.name as s_name, s.address as s_address, s.city as s_city, s.latitude as s_lat, s.longitude as s_lng, s.outstandingBalanceLkr as s_bal, s.allowedVisitRadiusMeters as s_rad FROM RouteStop rs JOIN Shop s ON rs.shopId = s.id WHERE rs.planId = ? ORDER BY rs.sequence ASC',
            [planId]
        );
        
        plan.stops = stopsRows.map(rs => ({
            id: rs.id, planId: rs.planId, shopId: rs.shopId, sequence: rs.sequence, plannedArrivalTime: rs.plannedArrivalTime, status: rs.status, completedVisitId: rs.completedVisitId,
            shop: { id: rs.s_id, name: rs.s_name, address: rs.s_address, city: rs.s_city, latitude: rs.s_lat, longitude: rs.s_lng, outstandingBalanceLkr: rs.s_bal, allowedVisitRadiusMeters: rs.s_rad }
        }));
        
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    return res.status(201).json(plan);
});
