import { Role } from '../../lib/enums.js';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { redirectToSignedObject, uploadObject } from '../files/object-storage.service.js';
import db from '../../lib/db.js';
import { env } from '../../config/env.js';
import { GoogleGenAI } from '@google/genai';
import { ragContextForStorage, retrieveCompanyData } from './ai-rag.service.js';
import { randomUUID } from 'node:crypto';

export const chatRouter = Router();
chatRouter.use(authenticate);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, /^(image\/(jpeg|png|webp)|audio\/(webm|mpeg|wav|ogg)|application\/pdf|text\/plain)$/.test(file.mimetype)),
});

const canMessage = async (tenantId, senderRole, recipientId) => {
    if (!recipientId) return senderRole !== Role.AGENT;
    const [users] = await db.query('SELECT id, role FROM User WHERE id = ? AND tenantId = ?', [recipientId, tenantId]);
    const recipient = users[0];
    return Boolean(recipient && (senderRole !== Role.AGENT || recipient.role !== Role.AGENT));
};

chatRouter.get('/contacts', async (req, res) => {
    const roles = req.auth.role === Role.AGENT ? [Role.MANAGER, Role.ADMIN] : [Role.AGENT];
    const placeholders = roles.map(() => '?').join(',');
    const [users] = await db.query(
        `SELECT id, name, role, avatarUrl, employeeCode FROM User WHERE tenantId = ? AND status = 'ACTIVE' AND role IN (${placeholders}) ORDER BY name ASC`,
        [req.auth.tenantId, ...roles]
    );
    res.json(users);
});

chatRouter.get('/messages', async (req, res) => {
    const peerId = String(req.query.peerId ?? '');
    const tenantId = req.auth.tenantId;
    const userId = req.auth.sub;
    
    let query = 'SELECT * FROM ChatMessage WHERE tenantId = ? AND (';
    const params = [tenantId];
    
    if (req.auth.role === Role.AGENT || peerId) {
        query += '(senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?) OR broadcast = true';
        params.push(userId, peerId, peerId, userId);
    } else {
        query += 'broadcast = true';
    }
    query += ') ORDER BY createdAt ASC LIMIT 200';
    
    const [messages] = await db.query(query, params);
    
    if (messages.length > 0) {
        const messageIds = messages.map(m => m.id);
        const placeholders = messageIds.map(() => '?').join(',');
        const [reads] = await db.query(`SELECT * FROM ChatRead WHERE messageId IN (${placeholders})`, messageIds);
        
        const readsMap = new Map();
        reads.forEach(r => {
            if (!readsMap.has(r.messageId)) readsMap.set(r.messageId, []);
            readsMap.get(r.messageId).push(r);
        });
        
        const senderIds = [...new Set(messages.map(m => m.senderId))];
        const sPlaceholders = senderIds.map(() => '?').join(',');
        const [senders] = await db.query(`SELECT id, name, role FROM User WHERE id IN (${sPlaceholders}) AND tenantId = ?`, [...senderIds, tenantId]);
        
        const sendersMap = new Map();
        senders.forEach(s => sendersMap.set(s.id, s));
        
        messages.forEach(m => {
            m.reads = readsMap.get(m.id) ?? [];
            m.sender = sendersMap.get(m.senderId) ?? null;
        });
    }
    
    res.json(messages);
});

chatRouter.post('/messages', upload.single('file'), async (req, res) => {
    const input = z.object({
        recipientId: z.string().optional(),
        broadcast: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
        content: z.string().max(4000).default(''),
        urgent: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
        type: z.enum(['TEXT', 'FILE', 'VOICE']).default('TEXT'),
    }).parse(req.body);
    
    if (!input.content.trim() && !req.file)
        return res.status(422).json({ error: { code: 'MESSAGE_EMPTY' } });
        
    if (!await canMessage(req.auth.tenantId, req.auth.role, input.broadcast ? undefined : input.recipientId)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This conversation is not allowed' } });
    }
    
    let attachmentKey;
    if (req.file) {
        attachmentKey = (await uploadObject({ tenantId: req.auth.tenantId, folder: 'chat', originalName: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer })).storageKey;
    }
    
    const messageId = randomUUID();
    const createdAt = new Date();
    
    await db.query(
        'INSERT INTO ChatMessage (id, tenantId, senderId, recipientId, broadcast, type, content, attachmentKey, attachmentName, attachmentMime, urgent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [messageId, req.auth.tenantId, req.auth.sub, input.broadcast ? null : (input.recipientId ?? null), input.broadcast, req.file ? input.type : 'TEXT', input.content.trim(), attachmentKey ?? null, req.file?.originalname ?? null, req.file?.mimetype ?? null, input.urgent, createdAt]
    );
    
    const [messages] = await db.query('SELECT * FROM ChatMessage WHERE id = ?', [messageId]);
    const message = messages[0];
    
    const payload = { ...message, sender: { id: req.auth.sub, role: req.auth.role } };
    const io = req.app.get('io');
    
    if (input.broadcast)
        io?.to(`tenant:${req.auth.tenantId}`).emit('chat:message', payload);
    else {
        io?.to(`user:${input.recipientId}`).emit('chat:message', payload);
        io?.to(`user:${req.auth.sub}`).emit('chat:message', payload);
    }
    
    return res.status(201).json(payload);
});

chatRouter.post('/messages/:id/read', async (req, res) => {
    const messageId = String(req.params.id);
    const [messages] = await db.query('SELECT * FROM ChatMessage WHERE id = ? AND tenantId = ?', [messageId, req.auth.tenantId]);
    const message = messages[0];
    
    if (!message || (message.recipientId && message.recipientId !== req.auth.sub) || message.senderId === req.auth.sub) {
        return res.status(404).send();
    }
    
    const now = new Date();
    await db.query(
        'INSERT INTO ChatRead (id, tenantId, messageId, userId, readAt) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE readAt = ?',
        [req.auth.tenantId, messageId, req.auth.sub, now, now]
    );
    
    const [receipts] = await db.query('SELECT * FROM ChatRead WHERE messageId = ? AND userId = ?', [messageId, req.auth.sub]);
    const receipt = receipts[0];
    
    req.app.get('io')?.to(`user:${message.senderId}`).emit('chat:read', receipt);
    return res.status(204).send();
});

chatRouter.get('/attachments/:messageId', async (req, res) => {
    const [messages] = await db.query('SELECT * FROM ChatMessage WHERE id = ? AND tenantId = ?', [String(req.params.messageId), req.auth.tenantId]);
    const message = messages[0];
    
    const allowed = message && (message.broadcast || message.senderId === req.auth.sub || message.recipientId === req.auth.sub);
    if (!allowed || !message?.attachmentKey)
        return res.status(404).send();
        
    res.setHeader('Content-Disposition', `inline; filename="${(message.attachmentName ?? 'attachment').replaceAll('"', '')}"`);
    res.type(message.attachmentMime ?? 'application/octet-stream');
    return redirectToSignedObject(res, message.attachmentKey);
});

const serializeAiMessage = (message) => ({
    id: message.id,
    senderId: message.role === 'USER' ? message.userId : 'ai',
    broadcast: false,
    type: 'AI',
    content: message.content,
    urgent: false,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    reads: [],
});

chatRouter.get('/ai/messages', async (req, res) => {
    const [messages] = await db.query(
        'SELECT * FROM AiMessage WHERE tenantId = ? AND userId = ? ORDER BY createdAt DESC LIMIT 200',
        [req.auth.tenantId, req.auth.sub]
    );
    res.json(messages.reverse().map(serializeAiMessage));
});

chatRouter.patch('/ai/messages/:id', async (req, res) => {
    const { content } = z.object({ content: z.string().trim().min(1).max(8000) }).parse(req.body);
    const id = String(req.params.id);
    
    const [messages] = await db.query('SELECT id FROM AiMessage WHERE id = ? AND tenantId = ? AND userId = ?', [id, req.auth.tenantId, req.auth.sub]);
    const current = messages[0];
    if (!current)
        return res.status(404).json({ error: { code: 'AI_MESSAGE_NOT_FOUND', message: 'AI message not found' } });
        
    await db.query('UPDATE AiMessage SET content = ? WHERE id = ?', [content, current.id]);
    const [updatedRows] = await db.query('SELECT * FROM AiMessage WHERE id = ?', [current.id]);
    
    return res.json(serializeAiMessage(updatedRows[0]));
});

const createAiMessages = async (req, res) => {
    const { prompt } = z.object({ prompt: z.string().trim().min(2).max(2000) }).parse(req.body);
    const tenantId = req.auth.tenantId;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    
    const [
        [agentsRes], [activeRes], [attendanceRes], [ordersRes], [revenueRes], [shopsRes], [productsRes]
    ] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM User WHERE tenantId = ? AND role = ? AND status = ?', [tenantId, Role.AGENT, 'ACTIVE']),
        db.query('SELECT COUNT(*) as c FROM AgentProfile p JOIN User u ON p.userId = u.id WHERE u.tenantId = ? AND p.status = ?', [tenantId, 'ACTIVE']),
        db.query('SELECT COUNT(*) as c FROM Attendance WHERE tenantId = ? AND date >= ?', [tenantId, today]),
        db.query('SELECT COUNT(*) as c FROM `Order` WHERE tenantId = ? AND createdAt >= ?', [tenantId, today]),
        db.query('SELECT SUM(totalAmountLkr) as s FROM `Order` WHERE tenantId = ? AND createdAt >= ?', [tenantId, today]),
        db.query('SELECT COUNT(*) as c FROM Shop WHERE tenantId = ? AND active = ?', [tenantId, true]),
        db.query('SELECT COUNT(*) as c FROM Product WHERE tenantId = ? AND active = ?', [tenantId, true]),
    ]);
    
    const context = { 
        agents: agentsRes[0].c, 
        activeAgents: activeRes[0].c, 
        presentToday: attendanceRes[0].c, 
        ordersToday: ordersRes[0].c, 
        revenueTodayLkr: Number(revenueRes[0].s ?? 0), 
        activeShops: shopsRes[0].c, 
        activeProducts: productsRes[0].c 
    };
    
    const rag = await retrieveCompanyData(prompt, req.auth);
    const actionIntent = /\b(assign|change|update|approve|cancel|delete|create)\b/i.test(prompt);
    const fallback = `Live operations summary: ${context.activeAgents}/${context.agents} agents active, ${context.presentToday} attendance records today, ${context.ordersToday} orders worth LKR ${context.revenueTodayLkr.toLocaleString()}, ${context.activeShops} active shops, and ${context.activeProducts} active products.${actionIntent ? ' I created a pending proposal; no business data was changed.' : ''}`;
    
    const normalizedPrompt = prompt.toLowerCase();
    let answer = rag.answer ?? (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(normalizedPrompt)
        ? `Hello! I’m your Reproutes Operations AI. I can help with live attendance, active agents, today’s orders and revenue, shops, products, and manager approval requests. What would you like to know?`
        : /\b(help|what can you do|how can you help)\b/.test(normalizedPrompt)
            ? `I can check live operations for you: ${context.activeAgents}/${context.agents} agents are active, ${context.presentToday} attendance records and ${context.ordersToday} orders are recorded today. Ask me about attendance, sales, revenue, shops, products, or request an action for manager approval.`
            : fallback);
            
    if (!rag.matched && env.GOOGLE_GENAI_API_KEY) {
        try {
            const response = await new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY }).models.generateContent({
                model: 'gemini-3.6-flash',
                contents: `You are Reproutes Operations AI. Answer concisely using only the supplied live tenant context. Never claim to have changed business data. If an action is requested, explain that manager confirmation is required.\nContext: ${JSON.stringify(context)}\nManager/agent question: ${prompt}`,
            });
            answer = response.text || fallback;
        }
        catch {
            answer = fallback;
        }
    }
    
    const storedContext = ragContextForStorage(rag, context);
    
    const connection = await db.getConnection();
    await connection.beginTransaction();
    let proposal = null;
    let messages = [];
    try {
        if (actionIntent) {
            const proposalId = randomUUID();
            await connection.query(
                'INSERT INTO AiActionProposal (id, tenantId, requestedBy, action, summary, payload, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [proposalId, tenantId, req.auth.sub, 'MANAGER_REVIEW_REQUIRED', prompt, JSON.stringify({ prompt, context }), 'PENDING', new Date()]
            );
            const [props] = await connection.query('SELECT * FROM AiActionProposal WHERE id = ?', [proposalId]);
            proposal = props[0];
        }
        
        const qId = randomUUID();
        const rId = randomUUID();
        const now = new Date();
        
        await connection.query(
            'INSERT INTO AiMessage (id, tenantId, userId, role, content, context, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [qId, tenantId, req.auth.sub, 'USER', prompt, JSON.stringify(storedContext), now, now]
        );
        
        await connection.query(
            'INSERT INTO AiMessage (id, tenantId, userId, role, content, context, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [rId, tenantId, req.auth.sub, 'ASSISTANT', answer, JSON.stringify(storedContext), now, now]
        );
        
        const [msgs] = await connection.query('SELECT * FROM AiMessage WHERE id IN (?, ?)', [qId, rId]);
        messages = [msgs.find(m => m.id === qId), msgs.find(m => m.id === rId)];
        
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
    
    if (proposal) {
        req.app.get('io')
            ?.to(`tenant:${tenantId}:role:${Role.MANAGER}`)
            .to(`tenant:${tenantId}:role:${Role.ADMIN}`)
            .emit('ai:proposal', {
            id: proposal.id,
            requestedBy: proposal.requestedBy,
            summary: proposal.summary,
            status: proposal.status,
            createdAt: proposal.createdAt,
        });
    }
    
    return res.status(201).json({ answer, context, citations: rag.citations, proposal, messages: messages.map(serializeAiMessage) });
};

chatRouter.post(['/ai', '/ai/messages'], createAiMessages);

chatRouter.get('/ai/proposals', async (req, res) => {
    if (req.auth.role === Role.AGENT)
        return res.status(403).send();
        
    const [proposals] = await db.query(
        'SELECT * FROM AiActionProposal WHERE tenantId = ? AND status = ? ORDER BY createdAt DESC LIMIT 50',
        [req.auth.tenantId, 'PENDING']
    );
    
    if (proposals.length === 0) return res.json([]);
    
    const requesterIds = [...new Set(proposals.map((proposal) => proposal.requestedBy))];
    const placeholders = requesterIds.map(() => '?').join(',');
    
    const [requesters] = await db.query(
        `SELECT id, name, employeeCode FROM User WHERE tenantId = ? AND id IN (${placeholders})`,
        [req.auth.tenantId, ...requesterIds]
    );
    
    res.json(proposals.map((proposal) => ({
        ...proposal,
        requester: requesters.find((requester) => requester.id === proposal.requestedBy),
    })));
});

chatRouter.post('/ai/proposals/:id/confirm', async (req, res) => {
    if (req.auth.role === Role.AGENT)
        return res.status(403).send();
        
    const id = String(req.params.id);
    const [proposals] = await db.query('SELECT * FROM AiActionProposal WHERE id = ? AND tenantId = ? AND status = ?', [id, req.auth.tenantId, 'PENDING']);
    const proposal = proposals[0];
    
    if (!proposal)
        return res.status(404).send();
        
    const [result] = await db.query(
        'UPDATE AiActionProposal SET status = ?, confirmedBy = ?, confirmedAt = ? WHERE id = ? AND tenantId = ? AND status = ?',
        ['CONFIRMED', req.auth.sub, new Date(), proposal.id, req.auth.tenantId, 'PENDING']
    );
    
    if (result.affectedRows === 0)
        return res.status(404).send();
        
    await db.query(
        'INSERT INTO AuditLog (tenantId, actorId, action, entity, entityId, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
        [req.auth.tenantId, req.auth.sub, 'AI_PROPOSAL_CONFIRMED', 'AiActionProposal', proposal.id, req.ip]
    );
    
    const confirmation = { id: proposal.id, requestedBy: proposal.requestedBy, status: 'CONFIRMED' };
    const io = req.app.get('io');
    io?.to(`user:${proposal.requestedBy}`).emit('ai:proposal-confirmed', confirmation);
    io?.to(`tenant:${req.auth.tenantId}:role:${Role.MANAGER}`).to(`tenant:${req.auth.tenantId}:role:${Role.ADMIN}`).emit('ai:proposal-confirmed', confirmation);
    
    res.json({ confirmed: true, executed: false, message: 'Proposal confirmed for a supported workflow; no automatic mutation was performed.' });
});
