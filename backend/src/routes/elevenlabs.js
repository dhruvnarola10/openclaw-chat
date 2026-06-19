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
router.get('/voices', async (req, res, next) => {
  try {
    const key = resolveKey(req);
    if (!key) return res.status(400).json({ error: { code: 'NO_KEY', message: 'No ElevenLabs API key' } });
    const r = await fetch(`${EL_BASE}/voices`, { headers: { 'xi-api-key': key } });
    const body = await r.text();
    if (!r.ok) {
      return res.status(r.status === 401 ? 401 : 502)
        .json({ error: { code: 'UPSTREAM', message: `elevenlabs voices ${r.status}`, detail: body.slice(0, 300) } });
    }
    res.type('application/json').send(body);
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
