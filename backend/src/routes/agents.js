// Agents endpoint:
//   GET    /agents                — real (from gateway) + virtual (from DB)
//   POST   /agents                — create virtual agent
//   PATCH  /agents/:id            — update virtual
//   DELETE /agents/:id            — delete virtual
//
// "Real" agents come from the gateway's models.list / node.list / agents.list
// (depending on what your gateway exposes); we forward the call and merge
// whatever it returns. Virtual agents are pure DB records that wrap a real
// agent with custom instructions.

import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, virtualAgents } from '../db/index.js';
import { getGateway } from '../gateway/client.js';
import { env } from '../env.js';

const router = Router();

function modelToStr(m) {
  if (m == null) return null;
  if (typeof m === 'string') return m;
  if (typeof m === 'object') {
    return m.primary ?? m.id ?? m.name ?? m.model ?? m.default ?? null;
  }
  return String(m);
}

function toStr(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return v.id ?? v.name ?? v.label ?? null;
  return String(v);
}

// Real agents are configured in the gateway (openclaw.json). The gateway's
// `agents.list` returns { defaultId, mainKey, scope, agents: AgentSummary[] }.
// IMPORTANT: do NOT fall back to `models.list` (that's LLM models, not agents)
// or `node.list` (that's paired remote machines).
async function fetchRealAgents() {
  const gw = getGateway({ url: env.gatewayWsUrl, token: env.gatewayToken });
  if (!gw.isReady()) return { items: [], defaultId: null };
  try {
    const payload = await gw.request('agents.list', {}, { timeoutMs: 4000 });
    const list = Array.isArray(payload?.agents) ? payload.agents : [];
    return {
      items: list.map((a) => ({
        id:        toStr(a.id ?? a.agentId ?? a.name) ?? '?',
        name:      toStr(a.name ?? a.identity?.name ?? a.label ?? a.id) ?? '',
        workspace: toStr(a.workspace ?? a.workspaceDir),
        model:     modelToStr(a.model ?? a.defaultModel ?? a.modelId),
        emoji:     toStr(a.identity?.emoji ?? a.emoji),
        avatar:    toStr(a.identity?.avatarUrl ?? a.identity?.avatar ?? a.avatar),
        kind:      'real',
        status:    toStr(a.status ?? a.state) ?? 'on',
      })),
      defaultId: toStr(payload?.defaultId),
    };
  } catch {
    return { items: [], defaultId: null };
  }
}

router.get('/', async (req, res) => {
  const [real, virtuals] = await Promise.all([
    fetchRealAgents(),
    db.select().from(virtualAgents).orderBy(desc(virtualAgents.createdAt)),
  ]);
  const virt = virtuals.map((v) => ({
    id:                 v.id,
    name:               v.name,
    baseAgentId:        v.baseAgentId,
    boardId:            v.boardId,
    role:               v.role,
    emoji:              v.emoji,
    communicationStyle: v.communicationStyle,
    heartbeatInterval:  v.heartbeatInterval,
    instructions:       v.instructions,
    description:        v.description,
    isBoardLead:        v.isBoardLead,
    kind:               'virtual',
    status:             v.status ?? 'active',
  }));
  res.json({ items: [...real.items, ...virt], defaultId: real.defaultId });
});

const CreateVirtual = z.object({
  name:                z.string().min(1).max(120),
  baseAgentId:         z.string().min(1).max(120),
  boardId:             z.string().uuid().nullable().optional(),
  role:                z.string().max(80).optional(),
  emoji:               z.string().max(8).optional(),
  communicationStyle:  z.string().max(200).optional(),
  heartbeatInterval:   z.string().regex(/^\d+(s|m|h|d)$/i, 'use 10m, 30m, 2h, 1d format').optional(),
  instructions:        z.string().optional(),
  description:         z.string().optional(),
  isBoardLead:         z.boolean().optional(),
});

router.post('/', async (req, res) => {
  const p = CreateVirtual.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.insert(virtualAgents).values(p.data).returning();
  res.status(201).json({ ...row, kind: 'virtual' });
});

router.patch('/:id', async (req, res) => {
  const p = CreateVirtual.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const [row] = await db.update(virtualAgents).set(p.data).where(eq(virtualAgents.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.json({ ...row, kind: 'virtual' });
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(virtualAgents).where(eq(virtualAgents.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  res.status(204).end();
});

// ── Real-agent CRUD (proxied to gateway) ─────────────────────────────────
// These call the gateway's `agents.{create,update,delete}` so the Mission
// Control UI can manage real agents without editing openclaw.json by hand.

const CreateReal = z.object({
  name:      z.string().min(1).max(120),
  workspace: z.string().min(1).max(500).optional(),  // auto-derived if omitted
  model:     z.string().min(1).optional(),
  emoji:     z.string().max(8).optional(),
  avatar:    z.string().optional(),
});

// Convention seen in our gateway: every agent's workspace is
//   <baseDir>/workspace            (the default `main` agent)
//   <baseDir>/workspace-<slug>     (any other agent)
// We derive <baseDir> by stripping the trailing /workspace[-...] segment
// from any existing agent. Returns null if we can't tell.
function deriveWorkspaceBase(agents) {
  for (const a of agents ?? []) {
    const ws = a.workspace ?? a.workspaceDir;
    if (typeof ws !== 'string' || !ws) continue;
    const m = ws.match(/^(.*)\/workspace(?:-.*)?$/);
    if (m) return m[1];
  }
  return null;
}

function slugifyName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

router.post('/real', async (req, res) => {
  const p = CreateReal.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const gw = getGateway({ url: env.gatewayWsUrl, token: env.gatewayToken });
  if (!gw.isReady()) return res.status(503).json({ error: { code: 'GATEWAY_OFFLINE' } });

  let workspace = p.data.workspace;
  if (!workspace) {
    try {
      const list = await gw.request('agents.list', {}, { timeoutMs: 4000 });
      const base = deriveWorkspaceBase(list?.agents);
      if (!base) {
        return res.status(409).json({ error: {
          code: 'NO_WORKSPACE_BASE',
          message: 'Could not derive workspace dir from existing agents; pass `workspace` explicitly.',
        }});
      }
      workspace = `${base}/workspace-${slugifyName(p.data.name)}`;
    } catch (e) {
      return res.status(502).json({ error: { code: 'GATEWAY_ERROR', message: e.message } });
    }
  }

  const params = { ...p.data, workspace };
  try {
    const result = await gw.request('agents.create', params, { timeoutMs: 8000 });
    res.status(201).json({ ...result, kind: 'real', workspace });
  } catch (e) {
    res.status(502).json({ error: { code: 'GATEWAY_ERROR', message: e.message } });
  }
});

const UpdateReal = z.object({
  name:      z.string().min(1).max(120).optional(),
  workspace: z.string().min(1).max(500).optional(),
  model:     z.string().min(1).optional(),
  emoji:     z.string().max(8).optional(),
  avatar:    z.string().optional(),
});

router.patch('/real/:agentId', async (req, res) => {
  const p = UpdateReal.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });
  const gw = getGateway({ url: env.gatewayWsUrl, token: env.gatewayToken });
  if (!gw.isReady()) return res.status(503).json({ error: { code: 'GATEWAY_OFFLINE' } });
  try {
    const result = await gw.request('agents.update', { agentId: req.params.agentId, ...p.data }, { timeoutMs: 8000 });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: { code: 'GATEWAY_ERROR', message: e.message } });
  }
});

router.delete('/real/:agentId', async (req, res) => {
  const deleteFiles = req.query.deleteFiles === 'true';
  const gw = getGateway({ url: env.gatewayWsUrl, token: env.gatewayToken });
  if (!gw.isReady()) return res.status(503).json({ error: { code: 'GATEWAY_OFFLINE' } });
  try {
    const result = await gw.request('agents.delete', { agentId: req.params.agentId, deleteFiles }, { timeoutMs: 8000 });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: { code: 'GATEWAY_ERROR', message: e.message } });
  }
});

export default router;
