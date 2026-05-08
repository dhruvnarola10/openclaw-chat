// Activity feed with filters. Mission-control parity:
//   ?limit=N (≤500), ?type=task.done, ?actor=<id>, ?since=<ISO>

import { Router } from 'express';
import { desc, and, eq, gte, like } from 'drizzle-orm';
import { db, activityLog } from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const where = [];

  if (req.query.type) {
    const t = String(req.query.type);
    if (t.endsWith('*')) {
      where.push(like(activityLog.type, `${t.slice(0, -1)}%`));
    } else {
      where.push(eq(activityLog.type, t));
    }
  }
  if (req.query.actor) where.push(eq(activityLog.actorId, String(req.query.actor)));
  if (req.query.since) {
    const d = new Date(String(req.query.since));
    if (!isNaN(d)) where.push(gte(activityLog.createdAt, d));
  }

  const rows = await db.select().from(activityLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);

  res.json({ items: rows });
});

export default router;
