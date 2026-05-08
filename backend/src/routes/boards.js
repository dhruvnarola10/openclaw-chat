import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, boards, tasks } from '../db/index.js';

const router = Router();

const Update = z.object({
  name:                                  z.string().min(1).max(160).optional(),
  description:                           z.string().optional(),
  defaultAgentId:                        z.string().nullable().optional(),
  defaultInstructions:                   z.string().nullable().optional(),
  boardType:                             z.string().optional(),
  objective:                             z.string().nullable().optional(),
  successMetrics:                        z.any().optional(),
  targetDate:                            z.string().datetime().nullable().optional(),
  goalConfirmed:                         z.boolean().optional(),
  requireApprovalForDone:                z.boolean().optional(),
  requireReviewBeforeDone:               z.boolean().optional(),
  commentRequiredForReview:              z.boolean().optional(),
  blockStatusChangesWithPendingApproval: z.boolean().optional(),
  onlyLeadCanChangeStatus:               z.boolean().optional(),
  maxAgents:                             z.number().int().min(1).max(20).optional(),
});

const CreateTask = z.object({
  title:             z.string().min(1).max(240),
  description:       z.string().optional(),
  priority:          z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assigneeAgentId:   z.string().optional(),
  assigneeKind:      z.enum(['real', 'virtual']).optional(),
  dueAt:             z.string().datetime().optional(),
  customFieldValues: z.record(z.any()).optional(),
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(boards).where(eq(boards.id, req.params.id));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.patch('/:id', async (req, res) => {
  const p = Update.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(boards).set(p.data).where(eq(boards.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(boards).where(eq(boards.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

// Nested tasks
router.get('/:id/tasks', async (req, res) => {
  const rows = await db.select().from(tasks)
    .where(eq(tasks.boardId, req.params.id))
    .orderBy(desc(tasks.createdAt));
  res.json({ items: rows });
});

router.post('/:id/tasks', async (req, res) => {
  const p = CreateTask.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const dueAt = p.data.dueAt ? new Date(p.data.dueAt) : null;
  const [row] = await db.insert(tasks).values({
    boardId:           req.params.id,
    title:             p.data.title,
    description:       p.data.description,
    priority:          p.data.priority,
    assigneeAgentId:   p.data.assigneeAgentId,
    assigneeKind:      p.data.assigneeKind,
    customFieldValues: p.data.customFieldValues,
    dueAt,
    status:            'inbox',
  }).returning();
  res.status(201).json(row);
});

export default router;
