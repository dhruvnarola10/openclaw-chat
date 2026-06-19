// ElevenLabs proxy.
//
// The browser never talks to api.elevenlabs.io directly — that would expose
// the API key in the bundle and hit CORS uncertainty. Instead the browser
// sends its request here with the user's key in the `X-Eleven-Key` header
// (or we fall back to the platform key in env). We forward to ElevenLabs and
// stream the result back.
//
//   GET  /api/v1/elevenlabs/voices          → list voices
//   GET  /api/v1/elevenlabs/models          → list models (TTS-capable)
//   POST /api/v1/elevenlabs/tts             → { voiceId, modelId, text } → audio bytes
//
// Auth: our normal JWT (requireAuth runs before this router). The ElevenLabs
// key is separate and supplied per-request via header, with env fallback.

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';

const router = Router();
const EL_BASE = 'https://api.elevenlabs.io/v1';

function resolveKey(req) {
  const fromHeader = req.get('x-eleven-key');
  return (typeof fromHeader === 'string' && fromHeader.trim())
    ? fromHeader.trim()
    : env.elevenLabsApiKey;
}

// ── List voices ───────────────────────────────────────────────────────────
// The legacy /v1/voices returns only a partial set. /v2/voices paginates
// (page_size up to 100) and returns the full library — we loop through all
// pages so the user sees every voice they have access to.
router.get('/voices', async (req, res, next) => {
  try {
    const key = resolveKey(req);
    if (!key) return res.status(400).json({ error: { code: 'NO_KEY', message: 'No ElevenLabs API key' } });

    const all = [];
    let pageToken = '';
    let guard = 0;
    while (guard < 20) {            // safety cap (20 * 100 = 2000 voices)
      guard += 1;
      const qs = new URLSearchParams({ page_size: '100' });
      if (pageToken) qs.set('next_page_token', pageToken);
      const r = await fetch(`${EL_BASE.replace('/v1', '/v2')}/voices?${qs.toString()}`, {
        headers: { 'xi-api-key': key },
      });
      if (!r.ok) {
        // Fall back to the legacy endpoint on the first page if v2 is unavailable.
        if (guard === 1) {
          const legacy = await fetch(`${EL_BASE}/voices`, { headers: { 'xi-api-key': key } });
          const body = await legacy.text();
          if (!legacy.ok) {
            return res.status(legacy.status === 401 ? 401 : 502)
              .json({ error: { code: 'UPSTREAM', message: `elevenlabs voices ${legacy.status}`, detail: body.slice(0, 300) } });
          }
          return res.type('application/json').send(body);
        }
        break;
      }
      const json = await r.json();
      const page = json?.voices ?? [];
      all.push(...page);
      if (json?.has_more && json?.next_page_token) pageToken = json.next_page_token;
      else break;
    }
    res.json({ voices: all });
  } catch (e) { next(e); }
});

// ── List models (filter to TTS-capable client-side, but pass all through) ──
router.get('/models', async (req, res, next) => {
  try {
    const key = resolveKey(req);
    if (!key) return res.status(400).json({ error: { code: 'NO_KEY', message: 'No ElevenLabs API key' } });
    const r = await fetch(`${EL_BASE}/models`, { headers: { 'xi-api-key': key } });
    const body = await r.text();
    if (!r.ok) {
      return res.status(r.status === 401 ? 401 : 502)
        .json({ error: { code: 'UPSTREAM', message: `elevenlabs models ${r.status}`, detail: body.slice(0, 300) } });
    }
    res.type('application/json').send(body);
  } catch (e) { next(e); }
});

// ── Text-to-speech ─────────────────────────────────────────────────────────
const TtsBody = z.object({
  voiceId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  text:    z.string().min(1).max(5000),
  stability:        z.number().min(0).max(1).optional(),
  similarityBoost:  z.number().min(0).max(1).optional(),
});

router.post('/tts', async (req, res, next) => {
  try {
    const key = resolveKey(req);
    if (!key) return res.status(400).json({ error: { code: 'NO_KEY', message: 'No ElevenLabs API key' } });
    const p = TtsBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });

    const { voiceId, modelId, text, stability, similarityBoost } = p.data;
    // mp3_44100_128 is broadly supported by <audio>; ?output_format keeps
    // payload small for fast playback on mobile.
    const url = `${EL_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: modelId || 'eleven_flash_v2_5',
        voice_settings: {
          stability:        stability ?? 0.5,
          similarity_boost: similarityBoost ?? 0.75,
        },
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      return res.status(upstream.status === 401 ? 401 : 502)
        .json({ error: { code: 'UPSTREAM', message: `elevenlabs tts ${upstream.status}`, detail: detail.slice(0, 300) } });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    const reader = upstream.body.getReader();
    res.on('close', () => { try { reader.cancel(); } catch { /* ignore */ } });
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) { next(e); }
});

export default router;
