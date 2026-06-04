// Express entry — runs natively under PM2 (`pm2 start ecosystem ... --only leonardo-api`).

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env, requireAppToken } from './env.js';
import { requireAuth } from './auth/middleware.js';

// API-only validation — worker doesn't need APP_TOKEN.
requireAppToken();

import authRouter         from './routes/auth.js';
import healthRouter       from './routes/health.js';
import orgsRouter         from './routes/orgs.js';
import boardGroupsRouter  from './routes/board-groups.js';
import boardsRouter       from './routes/boards.js';
import agentsRouter       from './routes/agents.js';
import tasksRouter        from './routes/tasks.js';
import approvalsRouter    from './routes/approvals.js';
import activityRouter     from './routes/activity.js';
import commentsRouter     from './routes/comments.js';
import tagsRouter         from './routes/tags.js';
import boardMemoryRouter  from './routes/board-memory.js';
import webhooksRouter     from './routes/webhooks.js';
import customFieldsRouter from './routes/custom-fields.js';
import dependenciesRouter from './routes/dependencies.js';
import channelsRouter     from './routes/channels.js';
import mediaRouter        from './routes/media.js';

const app = express();

// Behind nginx — trust the X-Forwarded-* headers so rate-limit sees real IPs.
app.set('trust proxy', 1);

// Security headers we want everywhere.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');
  res.setHeader('Referrer-Policy',        'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',     'camera=(), microphone=(self), geolocation=()');
  next();
});

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                          // curl, server-side
    if (env.allowedOrigins.length === 0) return cb(null, true);  // not configured: permissive
    if (env.allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));

// ── Public routes ───────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ name: 'leonardo-api', ok: true }));
app.use('/api/v1/health', healthRouter);

// /auth/register + /auth/login are public; /auth/me is internally guarded.
// Tight rate limit so attackers can't brute-force passwords.
const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });
app.use('/api/v1/auth', authLimiter, authRouter);

// ── Authed routes ───────────────────────────────────────────────────────
const writeLimiter = rateLimit({ windowMs: 60_000, max: 120 });

app.use('/api/v1', requireAuth);
app.use('/api/v1', writeLimiter);
app.use('/api/v1/orgs',         orgsRouter);
app.use('/api/v1/board-groups', boardGroupsRouter);
app.use('/api/v1/boards',       boardsRouter);
app.use('/api/v1/agents',       agentsRouter);
app.use('/api/v1/tasks',        tasksRouter);
app.use('/api/v1/approvals',    approvalsRouter);
app.use('/api/v1/activity',     activityRouter);
app.use('/api/v1/channels',     channelsRouter);
app.use('/api/v1/media',        mediaRouter);

// Cross-cutting routers — these mount paths under both /tasks/:id and
// top-level (e.g. /comments/:id). They use express params from the request URL.
app.use('/api/v1', commentsRouter);
app.use('/api/v1', tagsRouter);
app.use('/api/v1', boardMemoryRouter);
app.use('/api/v1', webhooksRouter);
app.use('/api/v1', customFieldsRouter);
app.use('/api/v1', dependenciesRouter);

// ── Error handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[api]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
});

const server = app.listen(env.port, () => {
  console.log(`[api] listening on ${env.port}`);
});

const shutdown = (sig) => {
  console.log(`[api] received ${sig}, closing…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
