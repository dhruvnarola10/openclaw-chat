// Per-board shared context document. Single row per board (boardId is PK).
// Content can be arbitrary text — markdown, system prompt, project notes,
// shared-state — that all tasks in this board will eventually be able to
// inject into agent prompts.

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, boardMemory, activityLog } from '../db/index.js';

const router = Router();

router.get('/boards/:boardId/memory', async (req, res) => {
  const [row] = await db.select().from(boardMemory)
    .where(eq(boardMemory.boardId, req.params.boardId));
  res.json(row ?? { boardId: req.params.boardId, content: '', updatedAt: null });
});

const Update = z.object({ content: z.string().max(200_000) });

router.put('/boards/:boardId/memory', async (req, res) => {
  const p = Update.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });

  const now = new Date();
  // Drizzle has no `onConflictDoUpdate` for non-pg-core in all versions;
  // manual upsert keeps it portable.
  const [existing] = await db.select().from(boardMemory)
    .where(eq(boardMemory.boardId, req.params.boardId));

  let row;
  if (existing) {
    [row] = await db.update(boardMemory)
      .set({ content: p.data.content, updatedAt: now })
      .where(eq(boardMemory.boardId, req.params.boardId))
      .returning();
  } else {
    [row] = await db.insert(boardMemory)
      .values({ boardId: req.params.boardId, content: p.data.content, updatedAt: now })
      .returning();
  }

  await db.insert(activityLog).values({
    type: 'board.memory.updated',
    payload: { boardId: row.boardId, length: row.content.length },
  });
  res.json(row);
});

export default router;
