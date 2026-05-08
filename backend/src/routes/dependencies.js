// Task dependency edges. A task is `is_blocked` while ANY of its
// dependencies is not yet `done`.

import { Router } from 'express';
import { eq, inArray, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, taskDependencies, tasks } from '../db/index.js';

const router = Router();

router.get('/tasks/:taskId/dependencies', async (req, res) => {
  const edges = await db.select().from(taskDependencies)
    .where(eq(taskDependencies.taskId, req.params.taskId));
  if (!edges.length) return res.json({ items: [], isBlocked: false, blockedBy: [] });

  const depIds = edges.map((e) => e.dependsOnTaskId);
  const deps = await db.select().from(tasks).where(inArray(tasks.id, depIds));
  const blocking = deps.filter((d) => d.status !== 'done').map((d) => d.id);
  res.json({
    items:     deps.map((d) => ({ id: d.id, title: d.title, status: d.status })),
    isBlocked: blocking.length > 0,
    blockedBy: blocking,
  });
});

const AddDep = z.object({ dependsOnTaskId: z.string().uuid() });

router.post('/tasks/:taskId/dependencies', async (req, res) => {
  const p = AddDep.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  if (req.params.taskId === p.data.dependsOnTaskId) {
    return res.status(400).json({ error: { code: 'INVALID', message: 'task cannot depend on itself' } });
  }
  await db.insert(taskDependencies)
    .values({ taskId: req.params.taskId, dependsOnTaskId: p.data.dependsOnTaskId })
    .onConflictDoNothing();
  res.status(201).json({ ok: true });
});

router.delete('/tasks/:taskId/dependencies/:depId', async (req, res) => {
  await db.delete(taskDependencies)
    .where(and(
      eq(taskDependencies.taskId, req.params.taskId),
      eq(taskDependencies.dependsOnTaskId, req.params.depId),
    ));
  res.status(204).end();
});

export default router;
