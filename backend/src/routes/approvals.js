// Approval queue. Agents post pending approvals; humans resolve them.
//
//   GET    /approvals?status=pending      — filterable list
//   POST   /approvals                     — create (agents call this when running)
//   PATCH  /approvals/:id                 — resolve (humans only)
//   GET    /approvals/stream              — live SSE feed

import { Router } from 'express';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, approvals, approvalTaskLinks, activityLog, tasks } from '../db/index.js';
import { attachSse, publishSse } from '../sse/bus.js';

const router = Router();

// Idempotent self-heal: any task currently in `review` that has no pending
// approval gets one inserted. This catches:
//   • Tasks that finished before the worker started auto-creating approvals
//   • Cases where the worker's INSERT failed (transient DB error, etc.)
//   • Manual PATCH /tasks/:id { status: 'review' } actions that bypass the worker
// Cheap because it only fires on the Approvals page load and the inner check
// short-circuits when nothing is missing.
async function backfillReviewApprovals() {
  const reviewTasks = await db.select().from(tasks).where(eq(tasks.status, 'review'));
  if (!reviewTasks.length) return 0;

  const taskIds = reviewTasks.map((t) => t.id);
  const existing = await db.select({ taskId: approvals.taskId })
    .from(approvals)
    .where(and(eq(approvals.status, 'pending'), inArray(approvals.taskId, taskIds)));
  const haveApproval = new Set(existing.map((r) => r.taskId));

  let created = 0;
  for (const t of reviewTasks) {
    if (haveApproval.has(t.id)) continue;
    const reasoning = `Task "${t.title}" finished and is awaiting review.`;
    const [row] = await db.insert(approvals).values({
      boardId:       t.boardId,
      taskId:        t.id,
      agentId:       t.assigneeAgentId,
      actionType:    'task.complete',
      payload:       { reason: reasoning, transcriptPreview: (t.lastResult ?? '').slice(0, 500) },
      leadReasoning: reasoning,
      status:        'pending',
    }).returning();
    await db.insert(approvalTaskLinks).values({ approvalId: row.id, taskId: t.id });
    await db.insert(activityLog).values({
      type:    'approval.created',
      payload: { id: row.id, taskIds: [t.id], agentId: t.assigneeAgentId, actionType: 'task.complete', autoCreated: true, backfilled: true },
    });
    publishSse('approvals', 'approval', { kind: 'created', approval: row, taskIds: [t.id] });
    created += 1;
  }
  return created;
}

router.get('/', async (req, res) => {
  // Self-heal first so the page shows them on this load, not the next one.
  try { await backfillReviewApprovals(); }
  catch (e) { console.warn('[approvals] backfill failed:', e.message); }

  const status = req.query.status;
  const where  = status ? eq(approvals.status, String(status)) : undefined;
  const rows = await db.select().from(approvals)
    .where(where)
    .orderBy(desc(approvals.createdAt))
    .limit(200);
  res.json({ items: rows });
});

// Mission-control parity: lead_reasoning is REQUIRED — either supplied as
// a top-level field, or embedded in payload.reason / payload.decision.reason.
const Create = z.object({
  boardId:        z.string().uuid().optional(),
  taskId:         z.string().uuid().optional(),
  taskIds:        z.array(z.string().uuid()).optional(),
  agentId:        z.string().optional(),
  actionType:     z.string().min(1).max(64),
  payload:        z.any().optional(),
  confidence:     z.number().min(0).max(100).optional(),
  rubricScores:   z.record(z.number()).optional(),
  leadReasoning:  z.string().min(1).optional(),
}).superRefine((v, ctx) => {
  const fromTop  = v.leadReasoning?.trim();
  const fromP    = typeof v.payload?.reason === 'string' && v.payload.reason.trim();
  const fromDec  = typeof v.payload?.decision?.reason === 'string' && v.payload.decision.reason.trim();
  if (!fromTop && !fromP && !fromDec) {
    ctx.addIssue({ code: 'custom', message: 'lead_reasoning is required (either as top-level field or in payload.reason)' });
  }
});

router.post('/', async (req, res) => {
  const p = Create.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });

  // Normalise multi-task: dedupe + align task_id with task_ids[0]
  const seen = new Set();
  const taskIds = [];
  if (p.data.taskId && !seen.has(p.data.taskId)) { seen.add(p.data.taskId); taskIds.push(p.data.taskId); }
  for (const id of (p.data.taskIds ?? [])) {
    if (!seen.has(id)) { seen.add(id); taskIds.push(id); }
  }

  // Promote leadReasoning to payload.reason for downstream consumers
  const reason = p.data.leadReasoning?.trim();
  const payload = p.data.payload && typeof p.data.payload === 'object'
    ? { ...p.data.payload, ...(reason ? { reason } : {}) }
    : (reason ? { reason } : null);

  const [row] = await db.insert(approvals).values({
    boardId:        p.data.boardId,
    taskId:         taskIds[0] ?? null,
    agentId:        p.data.agentId,
    actionType:     p.data.actionType,
    payload,
    confidence:     p.data.confidence != null ? Math.round(p.data.confidence) : null,
    rubricScores:   p.data.rubricScores,
    leadReasoning:  reason ?? null,
    status:         'pending',
  }).returning();

  if (taskIds.length) {
    await db.insert(approvalTaskLinks).values(
      taskIds.map((tid) => ({ approvalId: row.id, taskId: tid })),
    );
  }

  await db.insert(activityLog).values({
    type: 'approval.created',
    payload: { id: row.id, taskIds, agentId: row.agentId, actionType: row.actionType },
  });
  publishSse('approvals', 'approval', { kind: 'created', approval: row, taskIds });
  res.status(201).json({ ...row, taskIds });
});

const Resolve = z.object({
  status:     z.enum(['approved', 'rejected']),
  resolvedBy: z.string().optional(),
});

router.patch('/:id', async (req, res) => {
  const p = Resolve.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });

  const [row] = await db.update(approvals)
    .set({ status: p.data.status, resolvedAt: new Date(), resolvedBy: p.data.resolvedBy })
    .where(and(eq(approvals.id, req.params.id), eq(approvals.status, 'pending')))
    .returning();

  if (!row) return res.status(409).json({ error: { code: 'CONFLICT', message: 'approval not pending or not found' } });

  await db.insert(activityLog).values({
    type: `approval.${p.data.status}`,
    payload: { id: row.id, taskId: row.taskId, agentId: row.agentId },
  });
  publishSse('approvals', 'approval', { kind: 'resolved', approval: row });
  res.json(row);
});

router.get('/stream', (req, res) => attachSse(req, res, 'approvals'));

export default router;
