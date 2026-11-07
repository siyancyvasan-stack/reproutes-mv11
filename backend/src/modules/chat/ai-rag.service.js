import { Role } from '../../lib/enums.js';
import db from '../../lib/db.js';

const money = (value) => `LKR ${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const day = (value) => new Date(value).toISOString().slice(0, 10);
const citation = (type, id, label = id) => ({ type, id, label });
const cite = (source) => `[${source.type} ${source.label}]`;

const includesName = (items, current, history) => 
    [...items].sort((a, b) => b.name.length - a.name.length).find((item) => current.includes(item.name.toLowerCase())) ?? 
    [...items].sort((a, b) => b.name.length - a.name.length).find((item) => history.includes(item.name.toLowerCase()));

const technicalGuidance = (prompt) => {
    if (!/\b(system|technical|database|postgres|prisma|rag|api|how (?:does|do|can)|troubleshoot)\b/i.test(prompt))
        return '';
    return 'Technical guidance:\nThis assistant retrieves read-only, role-scoped records through authenticated Prisma queries. It does not directly update or delete operational records. Use the relevant validated Manager, Sales, or Factory workflow for data changes.';
};

export const retrieveCompanyData = async (prompt, auth) => {
    const tenantId = auth.tenantId;
    const current = prompt.toLowerCase();
    
    const [historyRows] = await db.query(
        'SELECT role, content FROM AiMessage WHERE tenantId = ? AND userId = ? ORDER BY createdAt DESC LIMIT 12',
        [tenantId, auth.sub]
    );
    
    const history = historyRows.reverse().map((row) => row.content.toLowerCase()).join('\n');
    const followUp = /\b(this|that|it|its|these|those|same|the (?:invoice|order|shop|agent|salesperson|product|payment))\b/i.test(current);
    const relevantHistory = followUp ? history : '';
    
    const agentOnly = auth.role === Role.AGENT;
    const agentScope = agentOnly ? auth.sub : undefined;
    
    const [[agents], [shops], [products]] = await Promise.all([
        db.query('SELECT id, name, employeeCode FROM User WHERE tenantId = ? AND role = ? AND status = ? LIMIT 200', [tenantId, Role.AGENT, 'ACTIVE']),
        db.query('SELECT id, name, retailerCode, assignedSalespersonId FROM Shop WHERE tenantId = ? LIMIT 200', [tenantId]),
        db.query('SELECT id, name, sku FROM Product WHERE tenantId = ? AND active = ? LIMIT 200', [tenantId, true]),
    ]);
    
    const currentAgent = includesName(agents, current, '');
    const requestedAgent = currentAgent ?? includesName(agents, '', relevantHistory);
    const selfAgent = agents.find((agent) => agent.id === auth.sub);
    const selectedAgent = agentOnly && /\b(my|me|mine|i)\b/i.test(current) ? selfAgent : requestedAgent ?? (agentOnly ? selfAgent : undefined);
    
    const selectedShop = includesName(shops, current, relevantHistory);
    const selectedProduct = includesName(products, current, relevantHistory);
    const guidance = technicalGuidance(prompt);
    const withGuidance = (answer) => guidance ? `${answer}\n\n${guidance}` : answer;
    
    if (agentOnly && currentAgent && currentAgent.id !== auth.sub) {
        return { matched: true, answer: withGuidance('You can only retrieve your own salesperson records. No other salesperson data was accessed.'), citations: [], retrieval: { intent: 'access_denied', entity: 'salesperson' } };
    }
    if (agentOnly && selectedShop && selectedShop.assignedSalespersonId !== auth.sub) {
        return { matched: true, answer: withGuidance('You can only retrieve shops assigned to you. No data for that shop was accessed.'), citations: [], retrieval: { intent: 'access_denied', entity: 'shop' } };
    }
    
    const invoicePattern = /\binv(?:[-\s]+)[a-z0-9][a-z0-9-]*\b/i;
    const invoiceToken = (current.match(invoicePattern)?.[0] ?? relevantHistory.match(invoicePattern)?.[0] ?? '').replace(/^inv[\s-]+/i, 'INV-');
    
    if (invoiceToken) {
        let invQuery = 'SELECT i.*, u.id as u_id, u.name as u_name, u.employeeCode as u_employeeCode, s.id as s_id, s.name as s_name, s.retailerCode as s_retailerCode, o.id as o_id, o.shopName as o_shopName FROM Invoice i LEFT JOIN User u ON i.salespersonId = u.id LEFT JOIN Shop s ON i.shopId = s.id LEFT JOIN `Order` o ON i.orderId = o.id WHERE i.tenantId = ? AND i.invoiceNumber = ?';
        const invParams = [tenantId, invoiceToken];
        
        if (agentScope) {
            invQuery += ' AND i.salespersonId = ?';
            invParams.push(agentScope);
        }
        
        const [invoices] = await db.query(invQuery, invParams);
        
        if (invoices.length === 0)
            return { matched: true, answer: withGuidance(`No invoice matching “${invoiceToken}” was found in the records you are allowed to access.`), citations: [], retrieval: { intent: 'invoice', notFound: invoiceToken } };
            
        const inv = invoices[0];
        
        inv.salesperson = inv.u_id ? { id: inv.u_id, name: inv.u_name, employeeCode: inv.u_employeeCode } : null;
        inv.shop = inv.s_id ? { id: inv.s_id, name: inv.s_name, retailerCode: inv.s_retailerCode } : null;
        inv.order = inv.o_id ? { id: inv.o_id, shopName: inv.o_shopName, items: [] } : null;
        
        const [items] = await db.query(
            'SELECT i.cases, i.totalAmount, p.id as p_id, p.name as p_name, p.sku as p_sku FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId = ?',
            [inv.o_id]
        );
        if (inv.order) inv.order.items = items.map(i => ({ cases: i.cases, totalAmount: i.totalAmount, product: { id: i.p_id, name: i.p_name, sku: i.p_sku } }));
        
        const [payments] = await db.query('SELECT * FROM Payment WHERE invoiceId = ? ORDER BY paidAt DESC LIMIT 20', [inv.id]);
        inv.payments = payments;
        
        const sources = [
            citation('Invoice', inv.id, inv.invoiceNumber), citation('Order', inv.order.id),
            citation('Agent', inv.salesperson.id, inv.salesperson.name),
            ...(inv.shop ? [citation('Shop', inv.shop.id, inv.shop.name)] : []),
            ...inv.payments.map((payment) => citation('Payment', payment.id, payment.reference ?? payment.id)),
        ];
        
        const itemsStr = inv.order.items.map((item) => `${item.product.name} (${item.cases} cases, ${money(item.totalAmount)})`).join(', ') || 'No line items';
        const paymentsStr = inv.payments.length
            ? inv.payments.map((payment) => `${money(payment.amountLkr)} via ${payment.method} on ${day(payment.paidAt)} ${cite(citation('Payment', payment.id, payment.reference ?? payment.id))}`).join('; ')
            : 'No payments recorded';
            
        const answer = `Invoice ${inv.invoiceNumber}: ${inv.status}, issued ${day(inv.issuedAt)}, due ${day(inv.dueAt)}. Total ${money(inv.totalLkr)}, paid ${money(inv.paidLkr)}, balance ${money(Number(inv.totalLkr) - Number(inv.paidLkr))}. Shop: ${inv.order.shopName}. Salesperson: ${inv.salesperson.name}. Items: ${itemsStr}. Payments: ${paymentsStr}.\n\nSources: ${sources.slice(0, 4).map(cite).join(' ')}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'invoice', invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, orderId: inv.order.id, agentId: inv.salesperson.id, shopId: inv.shopId } };
    }
    
    if (/\b(latest|recent|last)\b.*\binvoices?\b|\binvoices?\b.*\b(latest|recent|last)\b/i.test(current)) {
        if (!selectedAgent)
            return { matched: true, answer: withGuidance('Please name the salesperson whose latest invoices you want to see.'), citations: [], retrieval: { intent: 'latest_invoices', needs: 'salesperson' } };
            
        let q = 'SELECT i.*, o.id as o_id, o.shopName as o_shopName FROM Invoice i LEFT JOIN `Order` o ON i.orderId = o.id WHERE i.tenantId = ? AND i.salespersonId = ?';
        const p = [tenantId, selectedAgent.id];
        
        if (agentScope) {
            q += ' AND i.salespersonId = ?';
            p.push(agentScope);
        }
        
        q += ' ORDER BY i.issuedAt DESC LIMIT 5';
        
        const [invoices] = await db.query(q, p);
        const mappedInvoices = invoices.map(i => ({ ...i, order: { id: i.o_id, shopName: i.o_shopName } }));
        
        const sources = [citation('Agent', selectedAgent.id, selectedAgent.name), ...mappedInvoices.flatMap((row) => [citation('Invoice', row.id, row.invoiceNumber), citation('Order', row.order.id)])];
        const answer = mappedInvoices.length
            ? `Latest invoices for ${selectedAgent.name}:\n${mappedInvoices.map((row) => `• ${row.invoiceNumber} — ${row.order.shopName}, ${money(row.totalLkr)}, ${row.status}, ${day(row.issuedAt)} ${cite(citation('Invoice', row.id, row.invoiceNumber))}`).join('\n')}\n\nSource: ${cite(citation('Agent', selectedAgent.id, selectedAgent.name))}`
            : `No invoices were found for ${selectedAgent.name} in the records you are allowed to access. ${cite(citation('Agent', selectedAgent.id, selectedAgent.name))}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'latest_invoices', agentId: selectedAgent.id, invoiceIds: mappedInvoices.map((row) => row.id) } };
    }
    
    if (/\b(visits?|visited|shops? did)\b/i.test(current) && /\b(today|latest|recent)\b/i.test(current)) {
        if (!selectedAgent)
            return { matched: true, answer: withGuidance('Please name the salesperson whose shop visits you want to see.'), citations: [], retrieval: { intent: 'visits', needs: 'salesperson' } };
            
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setDate(to.getDate() + 1);
        
        let q = 'SELECT v.*, s.id as s_id, s.name as s_name, s.city as s_city FROM ShopVisit v JOIN Shop s ON v.shopId = s.id WHERE v.tenantId = ? AND v.agentId = ? AND v.visitedAt >= ? AND v.visitedAt < ?';
        const p = [tenantId, selectedAgent.id, from, to];
        
        if (agentScope) {
            q += ' AND v.agentId = ?';
            p.push(agentScope);
        }
        
        q += ' ORDER BY v.visitedAt DESC LIMIT 20';
        const [visits] = await db.query(q, p);
        const mappedVisits = visits.map(v => ({ ...v, shop: { id: v.s_id, name: v.s_name, city: v.s_city } }));
        
        const sources = [citation('Agent', selectedAgent.id, selectedAgent.name), ...mappedVisits.map((row) => citation('Shop', row.shop.id, row.shop.name))];
        const answer = mappedVisits.length
            ? `${selectedAgent.name} visited ${mappedVisits.length} shop${mappedVisits.length === 1 ? '' : 's'} today:\n${mappedVisits.map((row) => `• ${row.shop.name}, ${row.shop.city} at ${new Date(row.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${cite(citation('Shop', row.shop.id, row.shop.name))}`).join('\n')}\n\nSource: ${cite(citation('Agent', selectedAgent.id, selectedAgent.name))}`
            : `No shop visits were recorded today for ${selectedAgent.name}. ${cite(citation('Agent', selectedAgent.id, selectedAgent.name))}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'visits_today', agentId: selectedAgent.id, shopIds: mappedVisits.map((row) => row.shop.id) } };
    }
    
    if (/\b(sales|revenue|sold|complete)\b/i.test(current) && /\b(month|monthly|this month)\b/i.test(current)) {
        if (!selectedAgent)
            return { matched: true, answer: withGuidance('Please name the salesperson whose monthly sales you want to calculate.'), citations: [], retrieval: { intent: 'monthly_sales', needs: 'salesperson' } };
            
        const from = new Date();
        from.setDate(1);
        from.setHours(0, 0, 0, 0);
        
        let q = 'SELECT id, totalAmountLkr, status FROM `Order` WHERE tenantId = ? AND agentId = ? AND createdAt >= ? AND status != ?';
        const p = [tenantId, selectedAgent.id, from, 'CANCELLED'];
        
        if (agentScope) {
            q += ' AND agentId = ?';
            p.push(agentScope);
        }
        
        q += ' ORDER BY createdAt DESC LIMIT 100';
        const [orders] = await db.query(q, p);
        
        const total = orders.reduce((sum, row) => sum + Number(row.totalAmountLkr), 0);
        const sources = [citation('Agent', selectedAgent.id, selectedAgent.name), ...orders.slice(0, 10).map((row) => citation('Order', row.id))];
        const answer = `${selectedAgent.name} completed ${orders.length} non-cancelled order${orders.length === 1 ? '' : 's'} worth ${money(total)} this month.\n\nSources: ${sources.map(cite).join(' ') || 'No matching orders'}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'monthly_sales', agentId: selectedAgent.id, orderIds: orders.map((row) => row.id), totalLkr: total } };
    }
    
    if (selectedShop && /\b(shop|details?|orders?|payments?|products?|sales history|history)\b/i.test(current)) {
        let q = 'SELECT s.*, u.id as u_id, u.name as u_name FROM Shop s LEFT JOIN User u ON s.assignedSalespersonId = u.id WHERE s.id = ? AND s.tenantId = ?';
        const p = [selectedShop.id, tenantId];
        
        if (agentScope) {
            q += ' AND s.assignedSalespersonId = ?';
            p.push(agentScope);
        }
        
        const [shops] = await db.query(q, p);
        if (shops.length === 0)
            return { matched: true, answer: withGuidance(`No shop matching “${selectedShop.name}” was found in the records you are allowed to access.`), citations: [], retrieval: { intent: 'shop', notFound: selectedShop.name } };
            
        const shop = shops[0];
        shop.assignedSalesperson = shop.u_id ? { id: shop.u_id, name: shop.u_name } : null;
        
        const [[orders], [visits]] = await Promise.all([
            db.query('SELECT * FROM `Order` WHERE shopId = ? ORDER BY createdAt DESC LIMIT 10', [shop.id]),
            db.query('SELECT id, visitedAt, agentId FROM ShopVisit WHERE shopId = ? ORDER BY visitedAt DESC LIMIT 5', [shop.id])
        ]);
        
        if (orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            const placeholders = orderIds.map(() => '?').join(',');
            
            const [[items], [invoices]] = await Promise.all([
                db.query(`SELECT i.*, p.id as p_id, p.name as p_name, p.sku as p_sku FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId IN (${placeholders})`, orderIds),
                db.query(`SELECT * FROM Invoice WHERE orderId IN (${placeholders})`, orderIds)
            ]);
            
            let payments = [];
            if (invoices.length > 0) {
                const invoiceIds = invoices.map(i => i.id);
                const invPlaceholders = invoiceIds.map(() => '?').join(',');
                const [pRows] = await db.query(`SELECT * FROM Payment WHERE invoiceId IN (${invPlaceholders}) ORDER BY paidAt DESC`, invoiceIds);
                payments = pRows;
            }
            
            const itemsMap = new Map();
            items.forEach(i => {
                if (!itemsMap.has(i.orderId)) itemsMap.set(i.orderId, []);
                itemsMap.get(i.orderId).push({ ...i, product: { id: i.p_id, name: i.p_name, sku: i.p_sku } });
            });
            
            const paymentsMap = new Map();
            payments.forEach(p => {
                if (!paymentsMap.has(p.invoiceId)) paymentsMap.set(p.invoiceId, []);
                paymentsMap.get(p.invoiceId).push(p);
            });
            
            const invoiceMap = new Map();
            invoices.forEach(i => {
                invoiceMap.set(i.orderId, { ...i, payments: paymentsMap.get(i.id) ?? [] });
            });
            
            orders.forEach(o => {
                o.items = itemsMap.get(o.id) ?? [];
                o.invoice = invoiceMap.get(o.id) ?? null;
            });
        }
        
        shop.orders = orders;
        shop.visits = visits;
        
        const allPayments = shop.orders.flatMap((order) => order.invoice?.payments ?? []);
        const totalSales = shop.orders.filter((order) => order.status !== 'CANCELLED').reduce((sum, order) => sum + Number(order.totalAmountLkr), 0);
        const productNames = [...new Set(shop.orders.flatMap((order) => order.items.map((item) => item.product.name)))];
        const sources = [citation('Shop', shop.id, shop.name), ...(shop.assignedSalesperson ? [citation('Agent', shop.assignedSalesperson.id, shop.assignedSalesperson.name)] : []), ...shop.orders.map((order) => citation('Order', order.id)), ...allPayments.map((payment) => citation('Payment', payment.id, payment.reference ?? payment.id))];
        const answer = `${shop.name}: ${shop.status}, ${shop.address}, ${shop.city}. Assigned salesperson: ${shop.assignedSalesperson?.name ?? 'Unassigned'}. Recent sales: ${shop.orders.length} orders worth ${money(totalSales)}. Payments recorded: ${allPayments.length}, totaling ${money(allPayments.reduce((sum, payment) => sum + Number(payment.amountLkr), 0))}. Products in recent orders: ${productNames.join(', ') || 'None'}. Recent visits: ${shop.visits.length}.\n\nSources: ${sources.slice(0, 12).map(cite).join(' ')}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'shop_details', shopId: shop.id, orderIds: shop.orders.map((order) => order.id), paymentIds: allPayments.map((payment) => payment.id) } };
    }
    
    const paymentToken = current.match(/\bpayment\s*(?:id|reference|ref)?\s*[#:]?\s*([a-z0-9-]{4,})\b/i)?.[1];
    if (paymentToken) {
        const [payments] = await db.query(
            'SELECT p.*, i.id as i_id, i.invoiceNumber as i_invoiceNumber, o.id as o_id, o.shopName as o_shopName, u.id as u_id, u.name as u_name FROM Payment p JOIN Invoice i ON p.invoiceId = i.id JOIN `Order` o ON i.orderId = o.id JOIN User u ON i.salespersonId = u.id WHERE p.tenantId = ? AND (p.id LIKE ? OR p.reference LIKE ?)' + (agentScope ? ' AND i.salespersonId = ?' : ''),
            agentScope ? [tenantId, `%${paymentToken}%`, `%${paymentToken}%`, agentScope] : [tenantId, `%${paymentToken}%`, `%${paymentToken}%`]
        );
        
        if (payments.length === 0)
            return { matched: true, answer: withGuidance(`No payment matching “${paymentToken}” was found in the records you are allowed to access.`), citations: [], retrieval: { intent: 'payment', notFound: paymentToken } };
            
        const payment = payments[0];
        payment.invoice = { id: payment.i_id, invoiceNumber: payment.i_invoiceNumber, order: { id: payment.o_id, shopName: payment.o_shopName }, salesperson: { id: payment.u_id, name: payment.u_name } };
        
        const sources = [citation('Payment', payment.id, payment.reference ?? payment.id), citation('Invoice', payment.invoice.id, payment.invoice.invoiceNumber), citation('Order', payment.invoice.order.id), citation('Agent', payment.invoice.salesperson.id, payment.invoice.salesperson.name)];
        const answer = `Payment ${payment.reference ?? payment.id}: ${money(payment.amountLkr)} via ${payment.method}, paid ${day(payment.paidAt)} for invoice ${payment.invoice.invoiceNumber} (${payment.invoice.order.shopName}). Recorded invoice salesperson: ${payment.invoice.salesperson.name}.\n\nSources: ${sources.map(cite).join(' ')}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'payment', paymentId: payment.id, invoiceId: payment.invoice.id, orderId: payment.invoice.order.id, agentId: payment.invoice.salesperson.id } };
    }
    
    const orderToken = current.match(/\border\s*(?:id\s*)?[#:]?\s*([a-z0-9-]{8,})\b/i)?.[1];
    if (orderToken) {
        let q = 'SELECT o.*, u.id as u_id, u.name as u_name FROM `Order` o LEFT JOIN User u ON o.agentId = u.id WHERE o.tenantId = ? AND o.id LIKE ?';
        const p = [tenantId, `%${orderToken}%`];
        
        if (agentScope) {
            q += ' AND o.agentId = ?';
            p.push(agentScope);
        }
        
        const [orders] = await db.query(q, p);
        if (orders.length === 0)
            return { matched: true, answer: withGuidance(`No order matching “${orderToken}” was found in the records you are allowed to access.`), citations: [], retrieval: { intent: 'order', notFound: orderToken } };
            
        const order = orders[0];
        order.agent = order.u_id ? { id: order.u_id, name: order.u_name } : null;
        
        const [[items], [invoices]] = await Promise.all([
            db.query('SELECT i.*, p.id as p_id, p.name as p_name FROM OrderItem i JOIN Product p ON i.productId = p.id WHERE i.orderId = ?', [order.id]),
            db.query('SELECT * FROM Invoice WHERE orderId = ?', [order.id])
        ]);
        
        order.items = items.map(i => ({ ...i, product: { id: i.p_id, name: i.p_name } }));
        order.invoice = invoices.length > 0 ? invoices[0] : null;
        
        const sources = [citation('Order', order.id), citation('Agent', order.agent.id, order.agent.name), ...(order.invoice ? [citation('Invoice', order.invoice.id, order.invoice.invoiceNumber)] : [])];
        const answer = `Order ${order.id}: ${order.status}, ${order.shopName}, ${money(order.totalAmountLkr)}, created ${day(order.createdAt)}. Salesperson: ${order.agent.name}. Products: ${order.items.map((item) => `${item.product.name} × ${item.cases}`).join(', ') || 'None'}. Invoice: ${order.invoice?.invoiceNumber ?? 'Not issued'}.\n\nSources: ${sources.map(cite).join(' ')}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'order', orderId: order.id, agentId: order.agent.id, invoiceId: order.invoice?.id } };
    }
    
    if (selectedProduct && /\b(product|stock|sales|orders?)\b/i.test(current)) {
        let q = 'SELECT i.*, o.id as o_id, o.status as o_status, o.createdAt as o_createdAt, o.shopName as o_shopName FROM OrderItem i JOIN `Order` o ON i.orderId = o.id WHERE i.productId = ? AND o.tenantId = ?';
        const p = [selectedProduct.id, tenantId];
        
        if (agentScope) {
            q += ' AND o.agentId = ?';
            p.push(agentScope);
        }
        
        q += ' ORDER BY o.createdAt DESC LIMIT 10';
        
        const [[rows], [products]] = await Promise.all([
            db.query(q, p),
            db.query('SELECT * FROM Product WHERE id = ? AND tenantId = ?', [selectedProduct.id, tenantId])
        ]);
        
        const product = products[0];
        const mappedRows = rows.map(r => ({ ...r, order: { id: r.o_id, status: r.o_status, createdAt: r.o_createdAt, shopName: r.o_shopName } }));
        
        const sources = [citation('Product', selectedProduct.id, selectedProduct.name), ...mappedRows.map((row) => citation('Order', row.order.id))];
        const answer = `${selectedProduct.name} (${selectedProduct.sku}): ${money(product?.pricePerCaseLkr)} per case, ${product?.stockCases ?? 0} cases in stock. It appears in ${mappedRows.length} recent accessible order${mappedRows.length === 1 ? '' : 's'}, totaling ${mappedRows.reduce((sum, row) => sum + row.cases, 0)} cases.\n\nSources: ${sources.map(cite).join(' ')}`;
        return { matched: true, answer: withGuidance(answer), citations: sources, retrieval: { intent: 'product', productId: selectedProduct.id, orderIds: mappedRows.map((row) => row.order.id) } };
    }
    
    if (guidance)
        return { matched: true, answer: guidance, citations: [], retrieval: { intent: 'technical_guidance' } };
        
    return { matched: false, citations: [], retrieval: { intent: 'operations_summary' } };
};

export const ragContextForStorage = (result, liveContext) => ({
    liveContext,
    retrieval: result.retrieval,
    citations: result.citations,
});
