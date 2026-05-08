// webhook-deliver — POSTs the event JSON to the webhook URL with an HMAC
// signature in `X-Leonardo-Signature`. Persists the result in webhook_deliveries.

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, webhooks, webhookDeliveries } from '../../db/index.js';

const TIMEOUT_MS = 10_000;

export async function runWebhookDelivery({ webhookId, eventType, payload }) {
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
  if (!hook || !hook.active) return;

  const events = Array.isArray(hook.events) ? hook.events : [];
  if (events.length && !events.includes(eventType) && !events.includes('*')) return;

  const body = JSON.stringify({ event: eventType, payload, deliveredAt: new Date().toISOString() });
  const sig  = hook.secret
    ? crypto.createHmac('sha256', hook.secret).update(body).digest('hex')
    : null;

  let status = 'failed';
  let statusCode = null;
  let response = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Leonardo-Event':       eventType,
        ...(sig ? { 'X-Leonardo-Signature': `sha256=${sig}` } : {}),
        'User-Agent':             'leonardo-webhook/1.0',
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    statusCode = res.status;
    response   = (await res.text().catch(() => '')).slice(0, 5_000);
    status     = res.ok ? 'sent' : 'failed';
  } catch (e) {
    response = String(e?.message ?? e).slice(0, 5_000);
  }

  await db.insert(webhookDeliveries).values({
    webhookId, eventType, payload, status, statusCode, response, attemptCount: 1,
  });
  if (status === 'sent') {
    await db.update(webhooks)
      .set({ lastDeliveryAt: new Date() })
      .where(eq(webhooks.id, webhookId));
  }

  if (status === 'failed') {
    // Throwing makes BullMQ retry per the queue's `attempts` setting.
    throw new Error(`webhook ${webhookId} delivery failed: ${statusCode ?? response}`);
  }
}
