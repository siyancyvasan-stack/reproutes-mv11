import { FuelType, InvoiceStatus, OrderStatus, Role, StockMovementType } from '../../lib/enums.js';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import db from '../../lib/db.js';

const dateKey = /^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/;
export const filterSchema = z.object({
    from: z.string().regex(dateKey).optional(), to: z.string().regex(dateKey).optional(),
    period: z.enum(['daily', 'weekly', 'monthly']).optional(),
    agentId: z.string().min(1).max(64).optional(), shopId: z.string().min(1).max(64).optional(),
    productId: z.string().min(1).max(64).optional(), orderId: z.string().min(1).max(64).optional(),
    invoiceId: z.string().min(1).max(64).optional(), search: z.string().trim().max(120).optional(),
    status: z.string().trim().max(40).optional(), paymentStatus: z.nativeEnum(InvoiceStatus).optional(),
    fuelType: z.nativeEnum(FuelType).optional(),
}).strict().superRefine((value, context) => {
    if (value.from && value.to) {
        const from = new Date(value.from.includes('T') ? value.from : `${value.from}T00:00:00.000Z`);
        const to = new Date(value.to.includes('T') ? value.to : `${value.to}T23:59:59.999Z`);
        if (from > to)
            context.addIssue({ code: 'custom', path: ['from'], message: 'from must not be after to' });
        if (to.getTime() - from.getTime() > 366 * 86_400_000)
            context.addIssue({ code: 'custom', path: ['to'], message: 'range cannot exceed 366 days' });
    }
});

const getDateRangeParams = (filters) => {
    const from = filters.from ? new Date(filters.from.includes('T') ? filters.from : `${filters.from}T00:00:00.000Z`) : null;
    const to = filters.to ? new Date(filters.to.includes('T') ? filters.to : `${filters.to}T23:59:59.999Z`) : null;
    return { from, to };
};

const person = (scope) => scope.auth.role === Role.AGENT ? scope.auth.sub : scope.filters.agentId;
const orderStatus = (value) => z.nativeEnum(OrderStatus).safeParse(value).success ? value : undefined;
const movementType = (value) => z.nativeEnum(StockMovementType).safeParse(value).success ? value : undefined;
const money = (value) => Number(value ?? 0);
const durationMinutes = (start, end) => end ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000)) : null;

const orderColumns = [
    { header: 'Order ID', key: 'orderId', width: 24 }, { header: 'Date', key: 'date', width: 20 },
    { header: 'Agent', key: 'agent', width: 24 }, { header: 'Shop', key: 'shop', width: 28 },
    { header: 'Products', key: 'products', width: 45 }, { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Total', key: 'total', width: 16, currency: true }, { header: 'Payment', key: 'payment', width: 16 },
    { header: 'Status', key: 'status', width: 18 },
];

const productColumns = [
    { header: 'SKU', key: 'sku', width: 18 }, { header: 'Product', key: 'product', width: 28 },
    { header: 'Category', key: 'category', width: 20 }, { header: 'Stock', key: 'stock', width: 12 },
    { header: 'Units/Case', key: 'unitsPerCase', width: 12 }, { header: 'Price', key: 'price', width: 16, currency: true },
    { header: 'Sales Qty', key: 'salesQuantity', width: 12 }, { header: 'Remaining Stock', key: 'remainingStock', width: 16 },
];

const loadOrders = async (scope, factoryOnly = false) => {
    const agentId = person(scope);
    const { from, to } = getDateRangeParams(scope.filters);
    
    let q = 'SELECT o.id, o.createdAt, o.shopName, o.paymentTerm, o.status, o.totalAmountLkr, u.name as agent_name FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ?';
    const p = [scope.auth.tenantId];
    
    if (agentId) { q += ' AND o.agentId = ?'; p.push(agentId); }
    if (scope.filters.shopId) { q += ' AND o.shopId = ?'; p.push(scope.filters.shopId); }
    if (scope.filters.orderId) { q += ' AND o.id = ?'; p.push(scope.filters.orderId); }
    if (orderStatus(scope.filters.status)) { q += ' AND o.status = ?'; p.push(orderStatus(scope.filters.status)); }
    if (from) { q += ' AND o.createdAt >= ?'; p.push(from); }
    if (to) { q += ' AND o.createdAt <= ?'; p.push(to); }
    if (scope.filters.search) {
        q += ' AND (o.id LIKE ? OR o.shopName LIKE ? OR u.name LIKE ?)';
        p.push(`%${scope.filters.search}%`, `%${scope.filters.search}%`, `%${scope.filters.search}%`);
    }
    
    if (factoryOnly) {
        q += ` AND (
            EXISTS (SELECT 1 FROM ProductionOrder WHERE orderId = o.id) OR 
            EXISTS (SELECT 1 FROM Dispatch WHERE orderId = o.id) OR 
            o.status IN (?, ?, ?, ?, ?)
        )`;
        p.push(OrderStatus.PRODUCTION_REQUIRED, OrderStatus.IN_PRODUCTION, OrderStatus.QUALITY_CHECK, OrderStatus.READY, OrderStatus.DISPATCHED);
    }
    
    if (scope.filters.productId) {
        q += ' AND EXISTS (SELECT 1 FROM OrderItem WHERE orderId = o.id AND productId = ?)';
        p.push(scope.filters.productId);
    }
    
    q += ' ORDER BY o.createdAt DESC, o.id DESC LIMIT 100001';
    
    const [orders] = await db.query(q, p);
    
    if (orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        const [items] = await db.query(`SELECT i.orderId, i.cases, p.name as product_name FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId IN (${placeholders})`, orderIds);
        
        const itemsMap = new Map();
        items.forEach(i => {
            if (!itemsMap.has(i.orderId)) itemsMap.set(i.orderId, []);
            itemsMap.get(i.orderId).push(i);
        });
        
        orders.forEach(o => o.items = itemsMap.get(o.id) ?? []);
    } else {
        orders.forEach(o => o.items = []);
    }
    
    return orders.map(row => ({ 
        orderId: row.id, date: row.createdAt, agent: row.agent_name, shop: row.shopName,
        products: row.items.map(item => `${item.product_name} x ${item.cases}`).join(', '), quantity: row.items.reduce((sum, item) => sum + item.cases, 0),
        total: money(row.totalAmountLkr), payment: row.paymentTerm, status: row.status 
    }));
};

const loadProducts = async (scope, lowOnly = false) => {
    const { from, to } = getDateRangeParams(scope.filters);
    
    let q = 'SELECT id, sku, name, category, stockCases, reservedStock, unitsPerCase, pricePerCaseLkr FROM Product WHERE tenantId = ?';
    const p = [scope.auth.tenantId];
    
    if (scope.filters.productId) { q += ' AND id = ?'; p.push(scope.filters.productId); }
    if (scope.filters.search) {
        q += ' AND (name LIKE ? OR sku LIKE ?)';
        p.push(`%${scope.filters.search}%`, `%${scope.filters.search}%`);
    }
    if (lowOnly) {
        // Assume minimumStockLevel is e.g. 10 or from a config. Here we approximate Prisma's internal logic or a default.
        q += ' AND stockCases <= 10'; 
    }
    
    q += ' ORDER BY name ASC LIMIT 100001';
    
    const [products] = await db.query(q, p);
    
    if (products.length > 0) {
        const productIds = products.map(p => p.id);
        const placeholders = productIds.map(() => '?').join(',');
        
        let iq = `SELECT i.productId, i.cases FROM OrderItem i JOIN \`Order\` o ON i.orderId = o.id WHERE i.productId IN (${placeholders})`;
        const ip = [...productIds];
        
        if (from) { iq += ' AND o.createdAt >= ?'; ip.push(from); }
        if (to) { iq += ' AND o.createdAt <= ?'; ip.push(to); }
        
        const [items] = await db.query(iq, ip);
        
        const itemsMap = new Map();
        items.forEach(i => {
            if (!itemsMap.has(i.productId)) itemsMap.set(i.productId, 0);
            itemsMap.set(i.productId, itemsMap.get(i.productId) + i.cases);
        });
        
        products.forEach(p => p.salesQuantity = itemsMap.get(p.id) ?? 0);
    } else {
        products.forEach(p => p.salesQuantity = 0);
    }
    
    return products.map(row => ({ 
        sku: row.sku, product: row.name, category: row.category, stock: row.stockCases, unitsPerCase: row.unitsPerCase,
        price: money(row.pricePerCaseLkr), salesQuantity: row.salesQuantity, remainingStock: Math.max(0, row.stockCases - row.reservedStock) 
    }));
};

const definitions = {
    agents: { 
        roles: [Role.ADMIN, Role.MANAGER], title: 'Agents', columns: [
            { header: 'Employee Code', key: 'employeeCode' }, { header: 'Agent', key: 'name' }, { header: 'Email', key: 'email' }, { header: 'Phone', key: 'phone' }, { header: 'Region', key: 'region' }, { header: 'Status', key: 'status' }
        ],
        load: async (s) => {
            let q = 'SELECT employeeCode, name, email, phone, region, status FROM User WHERE tenantId = ? AND role = ?';
            const p = [s.auth.tenantId, Role.AGENT];
            if (s.filters.status) { q += ' AND status = ?'; p.push(s.filters.status); }
            if (s.filters.search) { q += ' AND name LIKE ?'; p.push(`%${s.filters.search}%`); }
            q += ' ORDER BY name ASC LIMIT 100001';
            const [rows] = await db.query(q, p);
            return rows;
        }
    },
    products: { roles: [Role.ADMIN, Role.MANAGER, Role.FACTORY_MANAGER], title: 'Products', columns: productColumns, load: s => loadProducts(s) },
    inventory: { roles: [Role.FACTORY_MANAGER], title: 'Inventory Stock Report', pdf: true, columns: productColumns, load: s => loadProducts(s) },
    low_stock: { roles: [Role.FACTORY_MANAGER], title: 'Low Stock Restock Report', pdf: true, columns: productColumns, load: s => loadProducts(s, true) },
    orders: { roles: [Role.ADMIN, Role.MANAGER, Role.AGENT], title: 'Orders', pdf: true, columns: orderColumns, load: s => loadOrders(s) },
    factory_orders: { roles: [Role.FACTORY_MANAGER], title: 'Factory Orders', columns: orderColumns, load: s => loadOrders(s, true) },
    invoices: { 
        roles: [Role.ADMIN, Role.MANAGER, Role.AGENT, Role.FACTORY_MANAGER], title: 'Invoices', allowEmpty: true, columns: [
            { header: 'Invoice', key: 'invoice' }, { header: 'Issued', key: 'issued' }, { header: 'Agent', key: 'agent' }, { header: 'Shop', key: 'shop' }, { header: 'Total', key: 'total', currency: true }, { header: 'Paid', key: 'paid', currency: true }, { header: 'Balance', key: 'balance', currency: true }, { header: 'Payment Status', key: 'status' }
        ],
        load: async (s) => { 
            const agentId = person(s); 
            const { from, to } = getDateRangeParams(s.filters);
            
            let q = 'SELECT i.invoiceNumber, i.issuedAt, i.totalLkr, i.paidLkr, i.status, u.name as salesperson_name, o.shopName FROM Invoice i LEFT JOIN User u ON i.salespersonId = u.id LEFT JOIN `Order` o ON i.orderId = o.id WHERE i.tenantId = ?';
            const p = [s.auth.tenantId];
            
            if (agentId) { q += ' AND i.salespersonId = ?'; p.push(agentId); }
            if (s.filters.shopId) { q += ' AND i.shopId = ?'; p.push(s.filters.shopId); }
            if (s.filters.invoiceId) { q += ' AND i.id = ?'; p.push(s.filters.invoiceId); }
            if (s.filters.paymentStatus) { q += ' AND i.status = ?'; p.push(s.filters.paymentStatus); }
            if (from) { q += ' AND i.issuedAt >= ?'; p.push(from); }
            if (to) { q += ' AND i.issuedAt <= ?'; p.push(to); }
            if (s.filters.search) {
                q += ' AND (i.invoiceNumber LIKE ? OR o.shopName LIKE ? OR u.name LIKE ?)';
                p.push(`%${s.filters.search}%`, `%${s.filters.search}%`, `%${s.filters.search}%`);
            }
            
            q += ' ORDER BY i.issuedAt DESC LIMIT 100001';
            
            const [rows] = await db.query(q, p);
            return rows.map(r => ({ invoice: r.invoiceNumber, issued: r.issuedAt, agent: r.salesperson_name, shop: r.shopName, total: money(r.totalLkr), paid: money(r.paidLkr), balance: money(r.totalLkr) - money(r.paidLkr), status: r.status })); 
        } 
    },
    attendance: { 
        roles: [Role.ADMIN, Role.MANAGER, Role.AGENT], title: 'Attendance', pdf: true, columns: [
            { header: 'Date', key: 'date' }, { header: 'Agent', key: 'agent' }, { header: 'Punch In', key: 'punchIn' }, { header: 'Punch Out', key: 'punchOut' }, { header: 'Working Hours', key: 'workingHours' }, { header: 'Distance KM', key: 'distance' }, { header: 'Status', key: 'status' }
        ],
        load: async (s) => { 
            const agentId = person(s); 
            const { from, to } = getDateRangeParams(s.filters);
            
            let q = 'SELECT a.date, a.checkInAt, a.checkOutAt, a.distanceKm, a.status, u.name as agent_name FROM Attendance a JOIN User u ON a.agentId = u.id WHERE a.tenantId = ?';
            const p = [s.auth.tenantId];
            
            if (agentId) { q += ' AND a.agentId = ?'; p.push(agentId); }
            if (from) { q += ' AND a.date >= ?'; p.push(from); }
            if (to) { q += ' AND a.date <= ?'; p.push(to); }
            
            q += ' ORDER BY a.date DESC LIMIT 100001';
            
            const [rows] = await db.query(q, p);
            return rows.map(r => ({ date: r.date, agent: r.agent_name, punchIn: r.checkInAt, punchOut: r.checkOutAt, workingHours: r.checkOutAt ? Number(((new Date(r.checkOutAt).getTime() - new Date(r.checkInAt).getTime()) / 3_600_000).toFixed(2)) : null, distance: r.distanceKm, status: r.status })); 
        } 
    },
    shop_visits: { 
        roles: [Role.ADMIN, Role.MANAGER, Role.AGENT], title: 'Shop Visit History', columns: [
            { header: 'Date', key: 'date' }, { header: 'Agent', key: 'agent' }, { header: 'Shop', key: 'shop' }, { header: 'Address', key: 'address' }, { header: 'Arrival', key: 'arrival' }, { header: 'Departure', key: 'departure' }, { header: 'Duration', key: 'duration' }, { header: 'Order ID', key: 'orderId' }, { header: 'Invoice ID', key: 'invoiceId' }, { header: 'Sales Amount', key: 'sales', currency: true }, { header: 'Payment Status', key: 'paymentStatus' }, { header: 'Notes', key: 'notes' }
        ],
        load: async (s) => { 
            const agentId = person(s); 
            const { from, to } = getDateRangeParams(s.filters);
            
            let q = 'SELECT v.id, v.visitedAt, v.departedAt, v.durationMinutes, v.notes, u.name as agent_name, s.name as shop_name, s.address as shop_address FROM ShopVisit v JOIN User u ON v.agentId = u.id JOIN Shop s ON v.shopId = s.id WHERE v.tenantId = ?';
            const p = [s.auth.tenantId];
            
            if (agentId) { q += ' AND v.agentId = ?'; p.push(agentId); }
            if (s.filters.shopId) { q += ' AND v.shopId = ?'; p.push(s.filters.shopId); }
            if (from) { q += ' AND v.visitedAt >= ?'; p.push(from); }
            if (to) { q += ' AND v.visitedAt <= ?'; p.push(to); }
            
            q += ' ORDER BY v.visitedAt DESC LIMIT 100001';
            
            const [rows] = await db.query(q, p);
            
            if (rows.length > 0) {
                const visitIds = rows.map(r => r.id);
                const placeholders = visitIds.map(() => '?').join(',');
                const [orders] = await db.query(
                    `SELECT o.id, o.visitId, o.totalAmountLkr, i.invoiceNumber, i.status FROM \`Order\` o LEFT JOIN Invoice i ON o.id = i.orderId WHERE o.visitId IN (${placeholders})`,
                    visitIds
                );
                
                const ordersMap = new Map();
                orders.forEach(o => {
                    if (!ordersMap.has(o.visitId)) ordersMap.set(o.visitId, []);
                    ordersMap.get(o.visitId).push({ id: o.id, totalAmountLkr: o.totalAmountLkr, invoice: o.invoiceNumber ? { invoiceNumber: o.invoiceNumber, status: o.status } : null });
                });
                
                rows.forEach(r => r.orders = ordersMap.get(r.id) ?? []);
            } else {
                rows.forEach(r => r.orders = []);
            }
            
            return rows.map(r => ({ 
                date: r.visitedAt, agent: r.agent_name, shop: r.shop_name, address: r.shop_address, arrival: r.visitedAt, departure: r.departedAt, 
                duration: r.durationMinutes ?? durationMinutes(r.visitedAt, r.departedAt), 
                orderId: r.orders.map(o => o.id).join(', '), 
                invoiceId: r.orders.map(o => o.invoice?.invoiceNumber).filter(Boolean).join(', '), 
                sales: r.orders.reduce((sum, o) => sum + money(o.totalAmountLkr), 0), 
                paymentStatus: [...new Set(r.orders.map(o => o.invoice?.status).filter(Boolean))].join(', '), 
                notes: r.notes 
            })); 
        } 
    },
    stock_movements: { 
        roles: [Role.FACTORY_MANAGER], title: 'Stock Movement', columns: [
            { header: 'Date', key: 'date' }, { header: 'SKU', key: 'sku' }, { header: 'Product', key: 'product' }, { header: 'Movement', key: 'type' }, { header: 'Quantity', key: 'quantity' }, { header: 'Balance', key: 'balance' }, { header: 'Reference', key: 'reference' }, { header: 'Notes', key: 'notes' }
        ],
        load: async (s) => { 
            const { from, to } = getDateRangeParams(s.filters);
            
            let q = 'SELECT m.createdAt, m.type, m.quantity, m.balanceAfter, m.referenceType, m.notes, p.sku as product_sku, p.name as product_name FROM InventoryMovement m JOIN Product p ON m.productId = p.id WHERE m.tenantId = ?';
            const p = [s.auth.tenantId];
            
            if (s.filters.productId) { q += ' AND m.productId = ?'; p.push(s.filters.productId); }
            if (movementType(s.filters.status)) { q += ' AND m.type = ?'; p.push(movementType(s.filters.status)); }
            if (from) { q += ' AND m.createdAt >= ?'; p.push(from); }
            if (to) { q += ' AND m.createdAt <= ?'; p.push(to); }
            
            q += ' ORDER BY m.createdAt DESC LIMIT 100001';
            
            const [rows] = await db.query(q, p);
            return rows.map(r => ({ date: r.createdAt, sku: r.product_sku, product: r.product_name, type: r.type, quantity: r.quantity, balance: r.balanceAfter, reference: r.referenceType, notes: r.notes })); 
        } 
    },
};

for (const [alias, source] of Object.entries({ daily_activity: 'shop_visits', route_history: 'shop_visits', weekly_performance: 'orders', monthly_performance: 'orders', sales_summary: 'orders', collection_summary: 'invoices', product_demand: 'products', product_sales: 'products', stock_report: 'inventory', factory_performance: 'factory_orders' })) {
    const base = definitions[source];
    definitions[alias] = { ...base, roles: ['daily_activity', 'route_history'].includes(alias) ? [...base.roles, Role.FACTORY_MANAGER] : base.roles, title: alias.split('_').map(v => v[0].toUpperCase() + v.slice(1)).join(' '), pdf: ['daily_activity', 'weekly_performance', 'monthly_performance', 'sales_summary', 'collection_summary', 'stock_report', 'factory_performance'].includes(alias) };
}

definitions.shops = definitions.retailers = { 
    roles: [Role.ADMIN, Role.MANAGER], title: 'Retailers', columns: [
        { header: 'Retailer Code', key: 'code' }, { header: 'Shop', key: 'shop' }, { header: 'Owner', key: 'owner' }, { header: 'Phone', key: 'phone' }, { header: 'Address', key: 'address' }, { header: 'City', key: 'city' }, { header: 'Route', key: 'route' }, { header: 'Assigned Agent', key: 'agent' }, { header: 'Outstanding', key: 'outstanding', currency: true }, { header: 'Status', key: 'status' }
    ],
    load: async (s) => { 
        let q = 'SELECT s.retailerCode, s.name, s.ownerName, s.phone, s.address, s.city, s.routeGroup, s.outstandingBalanceLkr, s.status, u.name as assigned_agent_name FROM Shop s LEFT JOIN User u ON s.assignedSalespersonId = u.id WHERE s.tenantId = ?';
        const p = [s.auth.tenantId];
        
        if (s.filters.shopId) { q += ' AND s.id = ?'; p.push(s.filters.shopId); }
        if (s.filters.status) { q += ' AND s.status = ?'; p.push(s.filters.status); }
        if (s.filters.search) {
            q += ' AND (s.name LIKE ? OR s.ownerName LIKE ? OR s.retailerCode LIKE ?)';
            p.push(`%${s.filters.search}%`, `%${s.filters.search}%`, `%${s.filters.search}%`);
        }
        
        q += ' ORDER BY s.name ASC LIMIT 100001';
        
        const [rows] = await db.query(q, p);
        return rows.map(r => ({ code: r.retailerCode, shop: r.name, owner: r.ownerName, phone: r.phone, address: r.address, city: r.city, route: r.routeGroup, agent: r.assigned_agent_name, outstanding: money(r.outstandingBalanceLkr), status: r.status })); 
    } 
};

definitions.fuel = { 
    roles: [Role.ADMIN, Role.MANAGER], title: 'Fuel Management', pdf: true, allowEmpty: true, columns: [
        { header: 'Purchased', key: 'date', width: 22 }, { header: 'Agent', key: 'agent', width: 20 }, { header: 'Vehicle', key: 'vehicle', width: 15 }, { header: 'Fuel Type', key: 'fuelType', width: 12 }, { header: 'Liters', key: 'liters', width: 10 }, { header: 'Tank Fill', key: 'tankFill', width: 12 }, { header: 'Price/Liter', key: 'price', width: 14, currency: true }, { header: 'Total', key: 'total', width: 14, currency: true }, { header: 'Station', key: 'station', width: 20 }, { header: 'Odometer', key: 'odometer', width: 13 }, { header: 'Status', key: 'status', width: 14 }
    ],
    load: async (s) => { 
        const { from, to } = getDateRangeParams(s.filters);
        
        let q = 'SELECT f.purchasedAt, f.fuelType, f.liters, f.isFullTank, f.pricePerLiter, f.totalAmount, f.fuelStation, f.odometerReading, f.status, u.name as salesperson_name, v.vehicleNumber FROM FuelEntry f LEFT JOIN User u ON f.salespersonId = u.id LEFT JOIN Vehicle v ON f.vehicleId = v.id WHERE f.tenantId = ?';
        const p = [s.auth.tenantId];
        
        if (s.filters.agentId) { q += ' AND f.salespersonId = ?'; p.push(s.filters.agentId); }
        if (s.filters.status) { q += ' AND f.status = ?'; p.push(s.filters.status); }
        if (s.filters.fuelType) { q += ' AND f.fuelType = ?'; p.push(s.filters.fuelType); }
        if (from) { q += ' AND f.purchasedAt >= ?'; p.push(from); }
        if (to) { q += ' AND f.purchasedAt <= ?'; p.push(to); }
        if (s.filters.search) {
            q += ' AND (f.fuelStation LIKE ? OR u.name LIKE ? OR v.vehicleNumber LIKE ?)';
            p.push(`%${s.filters.search}%`, `%${s.filters.search}%`, `%${s.filters.search}%`);
        }
        
        q += ' ORDER BY f.purchasedAt DESC LIMIT 100001';
        
        const [rows] = await db.query(q, p);
        return rows.map(r => ({ date: r.purchasedAt, agent: r.salesperson_name, vehicle: r.vehicleNumber, fuelType: r.fuelType, liters: r.liters, tankFill: r.isFullTank ? 'FULL TANK' : 'PARTIAL', price: money(r.pricePerLiter), total: money(r.totalAmount), station: r.fuelStation, odometer: r.odometerReading, status: r.status })); 
    } 
};

export const hasDefaultExportPermission = (role, dataset) => definitions[dataset]?.roles.includes(role) === true && !(role === Role.FACTORY_MANAGER && ['invoices', 'daily_activity', 'route_history', 'shop_visits'].includes(dataset));
export const canExport = async (auth, dataset) => {
    if (!definitions[dataset]?.roles.includes(auth.role))
        return false;
    const [settings] = await db.query('SELECT enabled FROM TenantRolePermission WHERE tenantId = ? AND role = ? AND capability = ?', [auth.tenantId, auth.role, `export:${dataset}`]);
    return settings[0]?.enabled ?? hasDefaultExportPermission(auth.role, dataset);
};

const cell = (value) => value instanceof Date ? value.toISOString() : value ?? '';
const csvCell = (value) => {
    const raw = String(cell(value));
    const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${neutralized.replaceAll('"', '""')}"`;
};

const filename = (title, filters, format) => `Reproutes_${title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}_${filters.from && filters.to ? `${filters.from}_${filters.to}` : new Date().toISOString().slice(0, 10)}.${format}`;

export const runExport = async (dataset, format, auth, query, res) => {
    const definition = definitions[dataset];
    if (!definition || !definition.roles.includes(auth.role) || !await canExport(auth, dataset))
        return { status: 403, code: 'EXPORT_FORBIDDEN', message: 'You do not have permission to export this data.' };
    if (format === 'pdf' && !definition.pdf)
        return { status: 422, code: 'FORMAT_NOT_SUPPORTED', message: 'PDF is available only for formatted reports.' };
    const parsed = filterSchema.safeParse(query);
    if (!parsed.success)
        return { status: 422, code: 'INVALID_EXPORT_FILTERS', message: 'One or more export filters are invalid.' };
    const rows = await definition.load({ auth, filters: parsed.data });
    const allowEmptyReport = definition.allowEmpty || (dataset === 'sales_summary' && format === 'pdf');
    if (!rows.length && !allowEmptyReport)
        return { status: 404, code: 'NO_EXPORT_RECORDS', message: 'No records available for the selected filters.' };
    const limit = format === 'pdf' ? 5_000 : 100_000;
    if (rows.length > limit)
        return { status: 413, code: 'EXPORT_TOO_LARGE', message: 'Narrow the selected filters before exporting.' };
    const outputName = filename(definition.title, parsed.data, format);
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (format === 'csv') {
        res.type('text/csv; charset=utf-8');
        res.write('\uFEFF');
        res.write(`${definition.columns.map(c => csvCell(c.header)).join(',')}\r\n`);
        for (const row of rows)
            res.write(`${definition.columns.map(c => csvCell(row[c.key])).join(',')}\r\n`);
        res.end();
        return null;
    }
    if (format === 'xlsx') {
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
        const sheet = workbook.addWorksheet(definition.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
        sheet.columns = definition.columns.map(c => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
        sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(definition.columns.length, 26))}1` };
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        sheet.getRow(1).commit();
        for (const row of rows)
            sheet.addRow(Object.fromEntries(definition.columns.map(c => [c.key, cell(row[c.key])]))).commit();
        sheet.commit();
        await workbook.commit();
        return null;
    }
    res.type('application/pdf');
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: definition.columns.length > 7 ? 'landscape' : 'portrait' });
    doc.pipe(res);
    const visible = definition.columns;
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWeight = visible.reduce((sum, column) => sum + (column.width ?? 20), 0);
    const widths = visible.map(column => availableWidth * (column.width ?? 20) / totalWeight);
    const rowHeight = 18;
    const drawTableHeader = () => {
        const y = doc.y;
        let x = doc.page.margins.left;
        doc.save().rect(x, y, availableWidth, rowHeight).fill('#0f766e').restore();
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#ffffff');
        visible.forEach((column, index) => { doc.text(column.header, x + 3, y + 5, { width: widths[index] - 6, height: rowHeight - 6, ellipsis: true, lineBreak: false }); x += widths[index]; });
        doc.y = y + rowHeight;
    };
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f172a').text('Reproutes').fontSize(15).text(definition.title).moveDown(.4);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Generated: ${new Date().toISOString()}`).text(`Filters: ${Object.entries(parsed.data).map(([k, v]) => `${k}=${v}`).join(', ') || 'None'}`).moveDown();
    drawTableHeader();
    if (!rows.length)
        doc.moveDown().font('Helvetica').fontSize(10).fillColor('#64748b').text(`No ${definition.title.toLowerCase()} records were available for the selected filters.`);
    rows.forEach((row, rowIndex) => {
        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            drawTableHeader();
        }
        const y = doc.y;
        let x = doc.page.margins.left;
        if (rowIndex % 2 === 1)
            doc.save().rect(x, y, availableWidth, rowHeight).fill('#f1f5f9').restore();
        doc.font('Helvetica').fontSize(6.5).fillColor('#334155');
        visible.forEach((column, index) => {
            const raw = cell(row[column.key]);
            const value = column.currency && raw !== '' ? `LKR ${Number(raw).toLocaleString('en-US')}` : String(raw);
            doc.text(value, x + 3, y + 5, { width: widths[index] - 6, height: rowHeight - 6, ellipsis: true, lineBreak: false });
            x += widths[index];
        });
        doc.y = y + rowHeight;
    });
    doc.end();
    return null;
};

export const exportDatasets = Object.keys(definitions);
