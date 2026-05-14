// Channel configuration storage — Telegram / Discord / WhatsApp.
//
//   GET    /channels             — list all configured channels
//   GET    /channels/:id         — fetch one
//   PUT    /channels/:id         — upsert config (create or replace)
//   DELETE /channels/:id         — remove config
//
// Telegram & Discord are wired through to the gateway's own files:
//   ~/.openclaw/openclaw.json                                  (channels.telegram)
//   ~/.openclaw/credentials/telegram-default-allowFrom.json    (Allowed User IDs)
//   ~/.openclaw/openclaw.json                                  (channels.discord)
//   ~/.openclaw/.env                                            (DISCORD_BOT_TOKEN)
//
// WhatsApp and iMessage don't have a doc-aligned integration yet, so they
// fall back to a local JSON file at backend/data/channels.json (round-trip
// in the UI but no propagation to the gateway).
//
// After saving Telegram the operator must:
//   1. Restart the gateway so the new bot token is picked up.
//   2. DM the bot to trigger a pairing request.
//   3. Run `openclaw pairing approve telegram <CODE>` (codes expire in 1h).

import { Router } from 'express';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  readOpenclawJson,
  mutateOpenclawJson,
  readAllowFrom,
  writeAllowFrom,
  parseAllowedUsers,
  readDotEnvKey,
  writeDotEnvKey,
  deleteDotEnvKey,
} from '../lib/openclaw-config.js';

const router = Router();

// iMessage is included alongside the others. The UI in src/components/channels
// surfaces all four; the backend has to accept all four too. iMessage falls
// through to the local-JSON fallback for now (same as Discord / WhatsApp) —
// no gateway-side write yet, but the saved values round-trip in the UI.
const SUPPORTED_IDS = new Set(['telegram', 'discord', 'whatsapp', 'imessage']);

const ChannelIdParam = z.string().refine((v) => SUPPORTED_IDS.has(v), {
  message: 'unsupported channel id',
});

const UpsertBody = z.object({
  config:  z.record(z.unknown()).default({}),
  enabled: z.boolean().optional(),
});

// ── Local JSON fallback (Discord / WhatsApp) ────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PATH = process.env.CHANNELS_CONFIG_PATH
  || path.resolve(__dirname, '..', '..', 'data', 'channels.json');

let writeChain = Promise.resolve();

async function readLocal() {
  try {
    const raw = await fs.readFile(LOCAL_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeLocal(data) {
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  const tmp = `${LOCAL_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, LOCAL_PATH);
}

function mutateLocal(fn) {
  const next = writeChain.then(async () => {
    const all = await readLocal();
    const result = await fn(all);
    await writeLocal(all);
    return result;
  });
  writeChain = next.catch(() => {});
  return next;
}

// ── Telegram adapter (openclaw.json + credentials) ──────────────────────
//
// Form values:
//   botToken      → channels.telegram.botToken
//   allowedUsers  → credentials/telegram-default-allowFrom.json (CSV → array)

async function readTelegram() {
  const cfg = await readOpenclawJson();
  const tg  = cfg.channels?.telegram;
  if (!tg && (await readAllowFrom('telegram')).length === 0) return null;

  const allow = await readAllowFrom('telegram');
  return {
    channelId: 'telegram',
    enabled:   tg?.enabled !== false,
    config: {
      botToken:     tg?.botToken ?? '',
      allowedUsers: allow.join(', '),
    },
    updatedAt: null,
  };
}

async function writeTelegram(formValues, enabled) {
  const botToken = String(formValues.botToken ?? '').trim();
  const allow    = parseAllowedUsers(formValues.allowedUsers);

  const result = await mutateOpenclawJson((cfg) => {
    const tg = cfg.channels.telegram ?? {};
    tg.enabled  = enabled ?? true;
    tg.botToken = botToken;
    // Preserve any user-set group policies, but seed a sane default.
    tg.groups ??= { '*': { requireMention: true } };
    cfg.channels.telegram = tg;
    return tg;
  });

  await writeAllowFrom('telegram', 'default', allow);

  return {
    channelId: 'telegram',
    enabled:   result.enabled,
    config: {
      botToken:     result.botToken ?? '',
      allowedUsers: allow.join(', '),
    },
    updatedAt: new Date().toISOString(),
  };
}

async function deleteTelegram() {
  let existed = false;
  await mutateOpenclawJson((cfg) => {
    if (cfg.channels.telegram) {
      existed = true;
      delete cfg.channels.telegram;
    }
  });
  // Wipe pairing/allow-list so a re-add starts clean.
  await writeAllowFrom('telegram', 'default', []);
  return existed;
}

// ── Discord adapter (openclaw.json + ~/.openclaw/.env) ──────────────────
//
// Per docs.openclaw.ai/channels/discord, the bot token must be sourced from
// an env var — managed installs put the value in ~/.openclaw/.env. The
// openclaw.json holds a reference, not the literal token:
//
//   channels.discord = {
//     enabled: true,
//     token:   { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" },
//     guilds:  { "<GUILD_ID>": { requireMention: false, users: [] } },
//     groupPolicy: "allowlist",
//   }
//
// Form values:
//   token     → ~/.openclaw/.env  → DISCORD_BOT_TOKEN
//   guildId   → channels.discord.guilds.<guildId>
//   channelId → preserved on the guild entry as `defaultChannelId` so the
//               agent can target it; not part of the gateway's strict schema
//               but kept as metadata so the UI round-trips it.
const DISCORD_TOKEN_VAR = 'DISCORD_BOT_TOKEN';

async function readDiscord() {
  const cfg = await readOpenclawJson();
  const dc  = cfg.channels?.discord;
  const dotEnvToken = await readDotEnvKey(DISCORD_TOKEN_VAR);

  if (!dc && !dotEnvToken) return null;

  // Resolve the token: prefer inline string config (legacy), else env ref.
  let token = '';
  if (typeof dc?.token === 'string') {
    token = dc.token;
  } else if (dc?.token?.source === 'env') {
    token = (await readDotEnvKey(dc.token.id || DISCORD_TOKEN_VAR)) ?? '';
  } else {
    token = dotEnvToken ?? '';
  }

  // The form only displays one guild today — pick the first one if multiple
  // exist (advanced users can edit openclaw.json directly for multi-guild).
  const guilds = dc?.guilds ?? {};
  const firstGuildId = Object.keys(guilds)[0] ?? '';
  const guildEntry   = firstGuildId ? guilds[firstGuildId] : null;

  return {
    channelId: 'discord',
    enabled:   dc?.enabled !== false,
    config: {
      token,
      guildId:   firstGuildId,
      channelId: guildEntry?.defaultChannelId ?? '',
    },
    updatedAt: null,
  };
}

async function writeDiscord(formValues, enabled) {
  const token     = String(formValues.token ?? '').trim();
  const guildId   = String(formValues.guildId ?? '').trim();
  const channelId = String(formValues.channelId ?? '').trim();

  // 1. Write the token to ~/.openclaw/.env. This is the canonical location
  //    for the gateway's managed-install pattern.
  if (token) {
    await writeDotEnvKey(DISCORD_TOKEN_VAR, token);
  }

  // 2. Write the discord block to openclaw.json. Use an env reference so
  //    the gateway looks up DISCORD_BOT_TOKEN at runtime.
  const result = await mutateOpenclawJson((cfg) => {
    const dc = cfg.channels.discord ?? {};
    dc.enabled = enabled ?? true;
    dc.token   = { source: 'env', provider: 'default', id: DISCORD_TOKEN_VAR };
    // Default to allowlist policy unless the user has already chosen otherwise.
    dc.groupPolicy ??= 'allowlist';
    if (guildId) {
      dc.guilds ??= {};
      const existing = dc.guilds[guildId] ?? {};
      dc.guilds[guildId] = {
        ...existing,
        // Keep existing users[] / requireMention if already set.
        users:          Array.isArray(existing.users) ? existing.users : [],
        requireMention: existing.requireMention ?? false,
        ...(channelId ? { defaultChannelId: channelId } : {}),
      };
    }
    cfg.channels.discord = dc;
    return dc;
  });

  return {
    channelId: 'discord',
    enabled:   result.enabled,
    config: {
      token:     token,    // echo back so the UI shows it on next load
      guildId,
      channelId,
    },
    updatedAt: new Date().toISOString(),
  };
}

async function deleteDiscord() {
  let existed = false;
  await mutateOpenclawJson((cfg) => {
    if (cfg.channels.discord) {
      existed = true;
      delete cfg.channels.discord;
    }
  });
  // Blank the env var so a stale token can't leak in on next restart.
  await deleteDotEnvKey(DISCORD_TOKEN_VAR);
  return existed;
}

// ── Local serializer for WhatsApp / iMessage (fallback) ────────────────
function serializeLocal(channelId, row) {
  if (!row) return null;
  return {
    channelId,
    config:    row.config ?? {},
    enabled:   row.enabled !== false,
    updatedAt: row.updatedAt ?? null,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const items = [];
    const tg = await readTelegram();
    if (tg) items.push(tg);

    const dc = await readDiscord();
    if (dc) items.push(dc);

    const local = await readLocal();
    for (const [id, row] of Object.entries(local)) {
      if (id === 'telegram' || id === 'discord') continue;   // openclaw.json wins
      items.push(serializeLocal(id, row));
    }
    res.json({ items });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  const idCheck = ChannelIdParam.safeParse(req.params.id);
  if (!idCheck.success) return res.status(400).json({ error: { code: 'INVALID', message: idCheck.error.message } });
  const id = idCheck.data;
  try {
    if (id === 'telegram') {
      const tg = await readTelegram();
      if (!tg) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return res.json(tg);
    }
    if (id === 'discord') {
      const dc = await readDiscord();
      if (!dc) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return res.json(dc);
    }
    const all = await readLocal();
    const row = all[id];
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    res.json(serializeLocal(id, row));
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  const idCheck = ChannelIdParam.safeParse(req.params.id);
  if (!idCheck.success) return res.status(400).json({ error: { code: 'INVALID', message: idCheck.error.message } });
  const id = idCheck.data;

  const p = UpsertBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: { code: 'INVALID', message: p.error.message } });

  try {
    if (id === 'telegram') {
      const saved = await writeTelegram(p.data.config, p.data.enabled);
      return res.status(200).json(saved);
    }
    if (id === 'discord') {
      const saved = await writeDiscord(p.data.config, p.data.enabled);
      return res.status(200).json(saved);
    }
    const saved = await mutateLocal(async (all) => {
      const row = {
        config:    p.data.config,
        enabled:   p.data.enabled ?? true,
        updatedAt: new Date().toISOString(),
      };
      all[id] = row;
      return row;
    });
    res.status(200).json(serializeLocal(id, saved));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  const idCheck = ChannelIdParam.safeParse(req.params.id);
  if (!idCheck.success) return res.status(400).json({ error: { code: 'INVALID', message: idCheck.error.message } });
  const id = idCheck.data;

  try {
    if (id === 'telegram') {
      const existed = await deleteTelegram();
      if (!existed) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return res.status(204).end();
    }
    if (id === 'discord') {
      const existed = await deleteDiscord();
      if (!existed) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return res.status(204).end();
    }
    const existed = await mutateLocal(async (all) => {
      if (!all[id]) return false;
      delete all[id];
      return true;
    });
    if (!existed) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
