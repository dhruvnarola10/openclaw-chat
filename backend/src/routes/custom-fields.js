// Custom field definitions (per-org). Field types match mission-control:
// text | text_long | integer | decimal | boolean | date | date_time | url | json

import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, customFieldDefinitions } from '../db/index.js';

const router = Router();

const FIELD_TYPES = ['text', 'text_long', 'integer', 'decimal', 'boolean', 'date', 'date_time', 'url', 'json'];
const UI_VIS      = ['always', 'if_set', 'hidden'];

const Create = z.object({
  fieldKey:         z.string().regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers, underscores only').max(64),
  label:            z.string().min(1).max(120),
  fieldType:        z.enum(FIELD_TYPES).default('text'),
  uiVisibility:     z.enum(UI_VIS).default('always'),
  validationRegex:  z.string().nullable().optional(),
  description:      z.string().nullable().optional(),
  required:         z.boolean().default(false),
  defaultValue:     z.any().optional(),
});

router.get('/orgs/:orgId/custom-fields', async (req, res) => {
  const rows = await db.select().from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.orgId, req.params.orgId))
    .orderBy(asc(customFieldDefinitions.label));
  res.json({ items: rows });
});

router.post('/orgs/:orgId/custom-fields', async (req, res) => {
  const p = Create.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  try {
    const [row] = await db.insert(customFieldDefinitions)
      .values({ orgId: req.params.orgId, ...p.data })
      .returning();
    res.status(201).json(row);
  } catch (e) {
    if (e.code === '23505') {        // pg unique-violation
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'fieldKey already used in this org' } });
    }
    throw e;
  }
});

router.patch('/custom-fields/:id', async (req, res) => {
  const p = Create.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(customFieldDefinitions)
    .set({ ...p.data, updatedAt: new Date() })
    .where(eq(customFieldDefinitions.id, req.params.id))
    .returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json(row);
});

router.delete('/custom-fields/:id', async (req, res) => {
  const [row] = await db.delete(customFieldDefinitions)
    .where(eq(customFieldDefinitions.id, req.params.id))
    .returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

export default router;
