// Webhooks. CRUD + delivery audit + manual test trigger.
// Outbound delivery itself is enqueued via BullMQ (queue.js) and handled
// by the worker job in src/worker/jobs/webhook-deliver.js.

import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, webhooks, webhookDeliveries } from '../db/index.js';
import { enqueueWebhookDelivery } from '../queue.js';

const router = Router();

router.get('/boards/:boardId/webhooks', async (req, res) => {
  const rows = await db.select().from(webhooks)
    .where(eq(webhooks.boardId, req.params.boardId))
    .orderBy(desc(webhooks.createdAt));
  res.json({ items: rows });
});

const Create = z.object({
  url:    z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

router.post('/boards/:boardId/webhooks', async (req, res) => {
  const p = Create.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(webhooks)
    .values({ boardId: req.params.boardId, ...p.data, events: p.data.events ?? [] })
    .returning();
  res.status(201).json(row);
});

router.patch('/webhooks/:id', async (req, res) => {
  const p = Create.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(webhooks).set(p.data).where(eq(webhooks.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/webhooks/:id', async (req, res) => {
  const [row] = await db.delete(webhooks).where(eq(webhooks.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

router.get('/webhooks/:id/deliveries', async (req, res) => {
  const rows = await db.select().from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, req.params.id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50);
  res.json({ items: rows });
});

router.post('/webhooks/:id/test', async (req, res) => {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, req.params.id));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  await enqueueWebhookDelivery({
    webhookId: row.id,
    eventType: 'test',
    payload:   { kind: 'manual-test', firedAt: new Date().toISOString() },
  });
  res.json({ ok: true });
});

export default router;
