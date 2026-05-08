import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, boardGroups, boards } from '../db/index.js';

const router = Router();

const Update = z.object({ name: z.string().min(1).max(120).optional() });
const CreateBoard = z.object({
  name:                z.string().min(1).max(160),
  defaultAgentId:      z.string().optional(),
  defaultInstructions: z.string().optional(),
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(boardGroups).where(eq(boardGroups.id, req.params.id));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.patch('/:id', async (req, res) => {
  const p = Update.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(boardGroups).set(p.data).where(eq(boardGroups.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(boardGroups).where(eq(boardGroups.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

// Nested boards
router.get('/:id/boards', async (req, res) => {
  const rows = await db.select().from(boards)
    .where(eq(boards.boardGroupId, req.params.id))
    .orderBy(desc(boards.createdAt));
  res.json({ items: rows });
});

router.post('/:id/boards', async (req, res) => {
  const p = CreateBoard.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(boards)
    .values({ boardGroupId: req.params.id, ...p.data })
    .returning();
  res.status(201).json(row);
});

export default router;
