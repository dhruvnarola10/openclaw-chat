// Task lifecycle:
//   GET    /tasks/:id           — task + recent runs
//   PATCH  /tasks/:id           — edit fields
//   DELETE /tasks/:id           — remove
//   POST   /tasks/:id/assign    — enqueue worker job (the central action)
//   POST   /tasks/:id/cancel    — abort current run (chat.abort on the gateway)
//   GET    /tasks/:id/stream    — SSE feed: status + transcript chunks

import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, tasks, taskRuns, activityLog } from '../db/index.js';
import { enqueueTaskAssign, enqueueTaskCancel } from '../queue.js';
import { attachSse } from '../sse/bus.js';

const router = Router();

const STATUS_ENUM   = ['inbox', 'in_progress', 'review', 'done'];
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent'];

const Update = z.object({
  title:              z.string().min(1).max(240).optional(),
  description:        z.string().nullable().optional(),
  status:             z.enum(STATUS_ENUM).optional(),
  priority:           z.enum(PRIORITY_ENUM).optional(),
  assigneeAgentId:    z.string().nullable().optional(),
  assigneeKind:       z.enum(['real', 'virtual']).nullable().optional(),
  dueAt:              z.string().datetime().nullable().optional(),
  customFieldValues:  z.record(z.any()).optional(),
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, req.params.id));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  const runs = await db.select().from(taskRuns)
    .where(eq(taskRuns.taskId, req.params.id))
    .orderBy(desc(taskRuns.startedAt))
    .limit(20);
  res.json({ ...row, runs });
});

router.patch('/:id', async (req, res) => {
  const p = Update.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const patch = { ...p.data, updatedAt: new Date() };
  if (patch.dueAt) patch.dueAt = new Date(patch.dueAt);
  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(tasks).where(eq(tasks.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

// ── Assign / cancel ─────────────────────────────────────────────────────

router.post('/:id/assign', async (req, res) => {
  const taskId = req.params.id;
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  if (!row.assigneeAgentId) {
    return res.status(400).json({ error: { code: 'NO_ASSIGNEE', message: 'task has no assignee' } });
  }

  // Mark in_progress immediately so the UI updates without waiting for worker pickup.
  await db.update(tasks)
    .set({ status: 'in_progress', inProgressAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, taskId));

  await db.insert(activityLog).values({
    type: 'task.assign-enqueued',
    payload: { taskId, agentId: row.assigneeAgentId, kind: row.assigneeKind },
  });

  await enqueueTaskAssign(taskId);
  res.json({ ok: true });
});

router.post('/:id/cancel', async (req, res) => {
  await enqueueTaskCancel(req.params.id);
  res.json({ ok: true });
});

router.get('/:id/stream', (req, res) => attachSse(req, res, `task:${req.params.id}`));

export default router;
