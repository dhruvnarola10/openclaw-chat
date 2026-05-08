// Comments on tasks. Mounted at /api/v1/tasks/:taskId/comments and
// /api/v1/comments/:id (delete only).

import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, taskComments, activityLog } from '../db/index.js';

const router = Router();

router.get('/tasks/:taskId/comments', async (req, res) => {
  const rows = await db.select().from(taskComments)
    .where(eq(taskComments.taskId, req.params.taskId))
    .orderBy(asc(taskComments.createdAt));
  res.json({ items: rows });
});

const Create = z.object({
  body:   z.string().min(1).max(20_000),
  author: z.string().min(1).max(120).optional(),
});

router.post('/tasks/:taskId/comments', async (req, res) => {
  const p = Create.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(taskComments).values({
    taskId: req.params.taskId,
    body:   p.data.body,
    author: p.data.author ?? 'user',
  }).returning();
  await db.insert(activityLog).values({
    type: 'comment.added',
    payload: { taskId: row.taskId, commentId: row.id, author: row.author },
  });
  res.status(201).json(row);
});

router.delete('/comments/:id', async (req, res) => {
  const [row] = await db.delete(taskComments).where(eq(taskComments.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

export default router;
