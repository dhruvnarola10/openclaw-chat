// Server-side proxy for OpenClaw's assistant-media route.
//
// The browser can't hit `/__openclaw__/assistant-media` directly when the
// gateway is on a different origin (CORS) or behind a proxy that doesn't
// forward that prefix. Instead the browser asks our backend, which already
// holds the user's gateway URL + token (passed in via query/headers) and
// can complete the two-step handshake:
//
//   1. GET <gw>/__openclaw__/assistant-media?source=<path>&meta=1
//      Authorization: Bearer <gatewayToken>
//      → { available, mediaTicket, mediaTicketExpiresAt }
//
//   2. GET <gw>/__openclaw__/assistant-media?source=<path>&mediaTicket=<ticket>
//      → raw image bytes (Content-Type set by gateway)
//
// then streams the bytes back to the browser. The route is mounted under
// `/api/v1/media/*` and the auth middleware allows `?token=` for it so
// <img src=...> tags work without setting headers.
//
//   GET /api/v1/media/proxy
//     ?source=<absolute path or media ref>
//     ?gw=<gateway-base-url>          (e.g. https://openclaw.example.com)
//     ?gt=<gateway-token>             (the user's OpenClaw token)
//     ?token=<our-jwt>                (our backend auth — required)

import { Router } from 'express';

const router = Router();
const MEDIA_PATH = '/__openclaw__/assistant-media';

function gatewayOrigin(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try { return new URL(urlString).origin; } catch { return null; }
}

router.get('/proxy', async (req, res, next) => {
  try {
    const source       = String(req.query.source ?? '');
    const gatewayUrl   = String(req.query.gw     ?? '');
    const gatewayToken = String(req.query.gt     ?? '');
    if (!source || !gatewayUrl) {
      return res.status(400).json({ error: { code: 'INVALID', message: 'source + gw are required' } });
    }
    const origin = gatewayOrigin(gatewayUrl);
    if (!origin) {
      return res.status(400).json({ error: { code: 'INVALID', message: 'gw must be an absolute URL' } });
    }

    // ── Step 1: meta ──────────────────────────────────────────────────
    const metaParams = new URLSearchParams({ source, meta: '1' });
    if (gatewayToken) metaParams.set('token', gatewayToken);
    const metaResp = await fetch(`${origin}${MEDIA_PATH}?${metaParams.toString()}`, {
      headers: gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {},
    });
    if (!metaResp.ok) {
      return res.status(metaResp.status === 401 ? 401 : 502)
        .json({ error: { code: 'UPSTREAM', message: `gateway meta ${metaResp.status}` } });
    }
    const meta = await metaResp.json();
    if (!meta?.available || !meta?.mediaTicket) {
      return res.status(404).json({
        error: { code: meta?.code ?? 'NOT_FOUND', message: meta?.reason ?? 'File not found' },
      });
    }

    // ── Step 2: stream the bytes back ────────────────────────────────
    const imgParams = new URLSearchParams({ source, mediaTicket: meta.mediaTicket });
    const imgResp = await fetch(`${origin}${MEDIA_PATH}?${imgParams.toString()}`);
    if (!imgResp.ok || !imgResp.body) {
      return res.status(502).json({ error: { code: 'UPSTREAM', message: `gateway media ${imgResp.status}` } });
    }
    const ct = imgResp.headers.get('content-type') || meta.mimeType || 'application/octet-stream';
    const cl = imgResp.headers.get('content-length');
    res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Pipe the upstream response into our HTTP response.
    const reader = imgResp.body.getReader();
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
