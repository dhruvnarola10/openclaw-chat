import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, organizations, boardGroups } from '../db/index.js';

const router = Router();

const Create = z.object({ name: z.string().min(1).max(120) });
const Update = z.object({ name: z.string().min(1).max(120).optional() });

router.get('/', async (req, res) => {
  const rows = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
  res.json({ items: rows });
});

router.post('/', async (req, res) => {
  const p = Create.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(organizations).values({ name: p.data.name }).returning();
  res.status(201).json(row);
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, req.params.id));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.patch('/:id', async (req, res) => {
  const p = Update.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(organizations)
    .set(p.data)
    .where(eq(organizations.id, req.params.id))
    .returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(organizations).where(eq(organizations.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

// Nested: list / create board groups under this org
router.get('/:id/board-groups', async (req, res) => {
  const rows = await db.select().from(boardGroups)
    .where(eq(boardGroups.orgId, req.params.id))
    .orderBy(desc(boardGroups.createdAt));
  res.json({ items: rows });
});

router.post('/:id/board-groups', async (req, res) => {
  const p = Create.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(boardGroups)
    .values({ orgId: req.params.id, name: p.data.name })
    .returning();
  res.status(201).json(row);
});

export default router;
