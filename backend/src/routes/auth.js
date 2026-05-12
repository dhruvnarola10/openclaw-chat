// /auth — email/password registration + login.
//
// POST /auth/register   → { token, user }
// POST /auth/login      → { token, user }
// GET  /auth/me         → { user }  (requires auth)
//
// Tokens are JWTs signed with env.jwtSecret, TTL = env.jwtTtlSeconds.
// Passwords are stored as bcrypt hashes (cost 10).

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, users } from '../db/index.js';
import { env } from '../env.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();

// Rate-limit register/login routes? express-rate-limit is already applied
// at /api/v1; we mount /auth BEFORE that, so an attacker can hammer login.
// Keep this in mind for production — wire a per-IP limiter here if needed.

const Register = z.object({
  email:    z.string().email().max(254).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  name:     z.string().min(1).max(120).optional(),
});

const Login = z.object({
  email:    z.string().email().max(254).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name ?? null },
    env.jwtSecret,
    { expiresIn: env.jwtTtlSeconds },
  );
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
}

router.post('/register', async (req, res) => {
  if (!env.jwtSecret) {
    return res.status(500).json({ error: { code: 'NO_JWT_SECRET', message: 'JWT_SECRET (or APP_TOKEN) must be set on the server' } });
  }

  const p = Register.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID', message: p.error.issues[0]?.message ?? p.error.message } });
  }

  // Reject duplicates with a 409 (Conflict). We do a SELECT first instead
  // of relying on a unique constraint so we control the error message.
  const [existing] = await db.select().from(users).where(eq(users.email, p.data.email));
  if (existing) {
    return res.status(409).json({ error: { code: 'EMAIL_TAKEN', message: 'an account with that email already exists' } });
  }

  const passwordHash = await bcrypt.hash(p.data.password, 10);
  const [row] = await db.insert(users).values({
    email:        p.data.email,
    passwordHash,
    name:         p.data.name ?? null,
  }).returning();

  const token = signToken(row);
  res.status(201).json({ token, user: publicUser(row) });
});

router.post('/login', async (req, res) => {
  if (!env.jwtSecret) {
    return res.status(500).json({ error: { code: 'NO_JWT_SECRET', message: 'JWT_SECRET (or APP_TOKEN) must be set on the server' } });
  }

  const p = Login.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID', message: 'email and password required' } });
  }

  const [row] = await db.select().from(users).where(eq(users.email, p.data.email));
  // Return a single generic message on miss vs wrong password to avoid
  // email-enumeration.
  const generic = { error: { code: 'BAD_CREDS', message: 'invalid email or password' } };
  if (!row) return res.status(401).json(generic);

  const ok = await bcrypt.compare(p.data.password, row.passwordHash);
  if (!ok) return res.status(401).json(generic);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));

  const token = signToken(row);
  res.json({ token, user: publicUser(row) });
});

router.get('/me', requireAuth, (req, res) => {
  if (req.user.kind === 'service') {
    return res.json({ user: { id: null, email: null, name: 'service', kind: 'service' } });
  }
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, kind: 'user' } });
});

export default router;
