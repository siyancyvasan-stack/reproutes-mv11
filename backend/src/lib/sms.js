import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
export const sendEmergencySms = async (recipients, message, eventId) => {
    if (!env.SMS_WEBHOOK_URL) {
        logger.warn({ eventId, recipientCount: recipients.length }, 'Emergency SMS skipped because SMS_WEBHOOK_URL is not configured');
        return { sent: 0, skipped: recipients.length };
    }
    const results = await Promise.allSettled(recipients.map(async (recipient) => {
        const response = await fetch(env.SMS_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.SMS_WEBHOOK_TOKEN}` } : {}),
            },
            body: JSON.stringify({ to: recipient.phone, message, eventId }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
            throw new Error(`SMS gateway returned ${response.status}`);
        return recipient.userId;
    }));
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    results.forEach((result, index) => {
        if (result.status === 'rejected')
            logger.error({ error: result.reason, eventId, userId: recipients[index]?.userId }, 'Emergency SMS delivery failed');
    });
    return { sent, skipped: recipients.length - sent };
};
