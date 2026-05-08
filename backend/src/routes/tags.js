// Per-org tag catalog + per-task tag assignments.

import { Router } from 'express';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, tags, taskTags } from '../db/index.js';

const router = Router();

// Tag catalog
router.get('/orgs/:orgId/tags', async (req, res) => {
  const rows = await db.select().from(tags)
    .where(eq(tags.orgId, req.params.orgId))
    .orderBy(asc(tags.name));
  res.json({ items: rows });
});

const CreateTag = z.object({
  name:  z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

router.post('/orgs/:orgId/tags', async (req, res) => {
  const p = CreateTag.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(tags).values({ orgId: req.params.orgId, ...p.data }).returning();
  res.status(201).json(row);
});

router.patch('/tags/:id', async (req, res) => {
  const p = CreateTag.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(tags).set(p.data).where(eq(tags.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/tags/:id', async (req, res) => {
  const [row] = await db.delete(tags).where(eq(tags.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

// Per-task assignments
router.get('/tasks/:taskId/tags', async (req, res) => {
  const links = await db.select().from(taskTags).where(eq(taskTags.taskId, req.params.taskId));
  if (!links.length) return res.json({ items: [] });
  const tagRows = await db.select().from(tags).where(inArray(tags.id, links.map((l) => l.tagId)));
  res.json({ items: tagRows });
});

router.post('/tasks/:taskId/tags', async (req, res) => {
  const p = z.object({ tagId: z.string().uuid() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  await db.insert(taskTags).values({ taskId: req.params.taskId, tagId: p.data.tagId })
    .onConflictDoNothing();
  res.status(201).json({ ok: true });
});

router.delete('/tasks/:taskId/tags/:tagId', async (req, res) => {
  await db.delete(taskTags)
    .where(and(eq(taskTags.taskId, req.params.taskId), eq(taskTags.tagId, req.params.tagId)));
  res.status(204).end();
});

export default router;
