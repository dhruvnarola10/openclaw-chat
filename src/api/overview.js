// Overview data fetcher.
//
// Builds a single snapshot of everything the dashboard cares about by
// calling several gateway WS methods in parallel. Each section has a list
// of candidate method names so different OpenClaw versions can be probed
// without code changes.

const REQ_TIMEOUT_MS = 4000;

// Race a request against a timeout so a hung method doesn't block the page.
function withTimeout(p, ms = REQ_TIMEOUT_MS) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

// Try each candidate method until one resolves; throws if all fail.
async function tryMethods(gateway, methods, params = {}) {
  const errors = [];
  for (const method of methods) {
    try {
      const payload = await withTimeout(gateway.request(method, params));
      return { method, payload };
    } catch (e) {
      errors.push(`${method}: ${e.message}`);
    }
  }
  const err = new Error(`No method matched. Tried: ${errors.join('; ')}`);
  err.tried = methods;
  throw err;
}

// Confirmed from openclaw_exp source (src/gateway/server-methods/, method-scopes.ts).
// Each entry stays as an array so we can fall back if a method is renamed
// between OpenClaw versions.

export const NODE_METHODS       = ['node.list'];
export const USAGE_COST_METHODS = ['usage.cost'];
export const USAGE_STATUS_METHODS = ['usage.status'];
export const SESSIONS_METHODS   = ['sessions.list'];
export const MODELS_METHODS     = ['models.list'];
export const SKILLS_METHODS     = ['skills.status', 'tools.catalog'];
export const CRON_METHODS       = ['cron.list', 'cron.status'];
export const CHANNELS_METHODS   = ['channels.status'];

export async function fetchOverview(gateway) {
  const tasks = {
    node:        tryMethods(gateway, NODE_METHODS),
    usage:       tryMethods(gateway, USAGE_COST_METHODS, { days: 30, mode: 'utc' }),
    usageStatus: tryMethods(gateway, USAGE_STATUS_METHODS),
    sessions:    tryMethods(gateway, SESSIONS_METHODS),
    models:      tryMethods(gateway, MODELS_METHODS),
    skills:      tryMethods(gateway, SKILLS_METHODS),
    cron:        tryMethods(gateway, CRON_METHODS),
    channels:    tryMethods(gateway, CHANNELS_METHODS),
  };

  const out = { errors: {} };
  await Promise.all(Object.entries(tasks).map(async ([key, task]) => {
    try { out[key] = await task; }
    catch (e) { out.errors[key] = e.message; }
  }));

  return out;
}

// ── Per-section payload normalisers ───────────────────────────────────────
//
// Each one is defensive: it accepts a few different shapes and falls back
// to `null` when the data isn't there.

// `node.list` returns either { nodes: [...] } or a bare array of node entries.
// Each entry typically has { id, name, status, uptimeMs, tickIntervalMs,
// lastRefreshAt, version }. We summarise to a single record (the local node).
export function pickNode(payload) {
  if (!payload) return null;
  const list = payload.nodes ?? payload.items ?? (Array.isArray(payload) ? payload : null);
  const p = (Array.isArray(list) ? (list.find((n) => n.local) ?? list[0]) : payload) ?? {};
  return {
    status:         p.status ?? p.health ?? (p.ok === true ? 'ok' : null),
    uptimeMs:       num(p.uptimeMs ?? p.uptime),
    tickIntervalMs: num(p.tickIntervalMs ?? p.tickInterval),
    lastRefreshAt:  num(p.lastRefreshAt ?? p.lastChannelsRefresh ?? p.channelsRefreshedAt),
    version:        p.version ?? null,
    name:           p.name   ?? p.id ?? null,
    nodeCount:      Array.isArray(list) ? list.length : null,
  };
}

// `usage.cost` returns { updatedAt, days, daily: [...], totals: {...} } where
// totals = { input, output, cacheRead, cacheWrite, totalTokens, totalCost, ...Cost }
export function pickUsage(payload) {
  if (!payload) return null;
  const t = payload.totals ?? payload;
  const daily = Array.isArray(payload.daily) ? payload.daily : [];
  return {
    totalCost:    num(t.totalCost),
    currency:     '$',
    totalTokens:  num(t.totalTokens),
    promptTokens: num(t.input),
    outputTokens: num(t.output),
    cacheRead:    num(t.cacheRead),
    cacheWrite:   num(t.cacheWrite),
    daysCovered:  num(payload.days) ?? daily.length,
    // We don't get a message count from usage.cost; sessions.usage has it.
    messages:     num(t.messages),
  };
}

// `sessions.list` returns { items|sessions: [{ key, displayName, channel,
// kind, updatedAt, model? }] } or a bare array.
export function pickSessions(payload) {
  if (!payload) return null;
  const items = payload.items ?? payload.sessions ?? (Array.isArray(payload) ? payload : []);
  return Array.isArray(items) ? items : [];
}

// `models.list` returns { models: [...] } or { data: [...] }.
export function pickModels(payload) {
  if (!payload) return null;
  const items = payload.models ?? payload.data ?? payload.items ?? (Array.isArray(payload) ? payload : []);
  return Array.isArray(items) ? items : [];
}

// `skills.status` returns { skills: [...], totals: { total, active }, ... }
// `tools.catalog`  returns { groups, profiles, entries: [...] } as fallback.
export function pickSkills(payload) {
  if (!payload) return null;
  const totals = payload.totals ?? payload.summary;
  if (totals && (totals.total != null || totals.active != null)) {
    return {
      total:  num(totals.total),
      active: num(totals.active),
      items:  payload.skills ?? payload.entries ?? [],
    };
  }
  // Plain list form
  const items = payload.skills ?? payload.entries ?? payload.items ?? (Array.isArray(payload) ? payload : []);
  if (Array.isArray(items)) {
    const total  = items.length;
    const active = items.filter((s) => s.active ?? s.enabled ?? true).length;
    return { total, active, items };
  }
  return null;
}

// `cron.list` returns { jobs: CronJob[] } where CronJob has { id, schedule,
// nextRunAt, lastRunAt, status, ... }
export function pickCron(payload) {
  if (!payload) return null;
  const items = payload.jobs ?? payload.crons ?? payload.items ?? (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(items)) return null;

  const next = items
    .map((j) => ({ ...j, _next: num(j.nextRunAt ?? j.nextWakeAt ?? j.next ?? j.runAt) }))
    .filter((j) => j._next != null)
    .sort((a, b) => a._next - b._next)[0];

  return { count: items.length, items, next };
}

// `channels.status` returns { channelAccounts: [{ provider, accountId, linked,
// connected, configured, lastError, tokenSource, ... }], ... }.
// Used as the "Model Auth" tile because OpenClaw's auth is via channels.
export function pickChannels(payload) {
  if (!payload) return null;
  const accounts = payload.channelAccounts ?? payload.accounts ?? payload.items
                ?? (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(accounts)) return null;

  const total    = accounts.length;
  const okCount  = accounts.filter((a) => a.connected === true || a.linked === true).length;
  const errored  = accounts.filter((a) => a.lastError).length;

  const firstError = accounts.find((a) => a.lastError);
  return { total, okCount, errored, items: accounts, firstError };
}

// `usage.status` returns { providers: [{ provider, displayName, windows: [{
//   label, usedPercent, resetAt }], plan?, error? }] } — live quota windows.
export function pickUsageStatus(payload) {
  if (!payload) return null;
  const providers = payload.providers ?? [];
  if (!Array.isArray(providers) || !providers.length) return null;

  // Find the most-stressed provider (highest usedPercent in any window).
  let worst = null;
  for (const p of providers) {
    for (const w of (p.windows ?? [])) {
      if (worst == null || (w.usedPercent ?? 0) > (worst.window.usedPercent ?? 0)) {
        worst = { provider: p, window: w };
      }
    }
  }
  return { providers, worst };
}

// ── helpers ───────────────────────────────────────────────────────────────

function num(v) { return v == null ? null : Number(v); }
