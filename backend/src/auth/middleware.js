// Single shared bearer-token guard. Apply with `app.use(requireAuth)`.
// Uses constant-time comparison so token-length-based timing attacks are
// not viable.

import crypto from 'crypto';
import { env } from '../env.js';

function safeEq(a, b) {
  const aBuf = Buffer.from(a ?? '', 'utf8');
  const bBuf = Buffer.from(b ?? '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  // SSE endpoints (`/stream`) accept ?token=... because EventSource
  // can't set Authorization headers from the browser. Other paths still
  // require the header to keep tokens out of normal access logs.
  const fromHeader = m?.[1] ?? '';
  const fromQuery  = req.path.endsWith('/stream') ? (req.query.token ?? '') : '';
  const token = fromHeader || fromQuery;
  if (!safeEq(token, env.appToken)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid bearer token' } });
  }
  next();
}
