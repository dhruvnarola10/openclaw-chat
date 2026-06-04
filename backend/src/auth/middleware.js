// Bearer-token guard supporting two identities:
//   • APP_TOKEN (service / curl / dev scripts) — constant-time compared.
//   • JWT issued by /auth/login — verified with env.jwtSecret.
// On success, req.user is set to { kind: 'service' } or
// { kind: 'user', id, email, name }.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
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
  // SSE endpoints (`/stream`) and the media proxy (`/media/*`, hit by
  // `<img src=>`) accept ?token=... because neither EventSource nor the
  // image element can set Authorization headers from the browser.
  // Other paths still require the header to keep tokens out of access logs.
  const fromHeader = m?.[1] ?? '';
  const allowQuery = req.path.endsWith('/stream') || req.path.startsWith('/media/');
  const fromQuery  = allowQuery ? (req.query.token ?? '') : '';
  const token = fromHeader || fromQuery;

  if (!token) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'missing bearer token' } });
  }

  // 1. Service token (legacy / scripts).
  if (env.appToken && safeEq(token, env.appToken)) {
    req.user = { kind: 'service' };
    return next();
  }

  // 2. User JWT.
  if (env.jwtSecret) {
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      req.user = {
        kind:  'user',
        id:    payload.sub,
        email: payload.email,
        name:  payload.name ?? null,
      };
      return next();
    } catch {
      // fall through to 401
    }
  }

  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid bearer token' } });
}
