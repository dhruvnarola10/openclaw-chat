// Per-user voice settings — synced server-side so the same account gets the
// same ElevenLabs config (key, voice, model) on every device.
//
//   GET /api/v1/voice-settings   → { apiKey, voiceId, modelId } | {}
//   PUT /api/v1/voice-settings   → upsert the row for req.user.id
//
// Scoped to req.user.id (JWT). Service tokens have no user row, so they get
// an empty object and can't write.

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, userVoiceSettings } from '../db/index.js';

const router = Router();

const Body = z.object({
  apiKey:  z.string().max(200).optional().nullable(),
  voiceId: z.string().max(120).optional().nullable(),
  modelId: z.string().max(120).optional().nullable(),
});

router.get('/', async (req, res, next) => {
  try {
    if (req.user?.kind !== 'user') return res.json({});
    const [row] = await db.select().from(userVoiceSettings)
      .where(eq(userVoiceSettings.userId, req.user.id)).limit(1);
    if (!row) return res.json({});
    res.json({ apiKey: row.apiKey ?? '', voiceId: row.voiceId ?? '', modelId: row.modelId ?? '' });
  } catch (e) { next(e); }
});

router.put('/', async (req, res, next) => {
  try {
    if (req.user?.kind !== 'user') {
      return res.status(403).json({ error: { code: 'NO_USER', message: 'voice settings require a user account' } });
    }
    const p = Body.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });

    const values = {
      userId:    req.user.id,
      apiKey:    p.data.apiKey ?? null,
      voiceId:   p.data.voiceId ?? null,
      modelId:   p.data.modelId ?? null,
      updatedAt: new Date(),
    };
    await db.insert(userVoiceSettings).values(values)
      .onConflictDoUpdate({
        target: userVoiceSettings.userId,
        set: { apiKey: values.apiKey, voiceId: values.voiceId, modelId: values.modelId, updatedAt: values.updatedAt },
      });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
