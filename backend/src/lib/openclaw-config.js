// Read/write helpers for the OpenClaw gateway's config + credentials files.
//
//   ~/.openclaw/openclaw.json
//   ~/.openclaw/credentials/<channel>-<account>-allowFrom.json
//
// Path root is overridable with OPENCLAW_HOME for tests / custom installs.
// All writes go through writeJsonAtomic() which:
//   - creates a .bak copy of the previous file (matches the gateway CLI),
//   - writes to a temp file then renames over the target so partial writes
//     can never corrupt the live config.

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export function getOpenclawHome() {
  return process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
}

export function getOpenclawJsonPath() {
  return path.join(getOpenclawHome(), 'openclaw.json');
}

export function getCredentialsDir() {
  return path.join(getOpenclawHome(), 'credentials');
}

export function getAllowFromPath(channel, account = 'default') {
  return path.join(getCredentialsDir(), `${channel}-${account}-allowFrom.json`);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Backup existing file (if any) so an operator can recover.
  try {
    await fs.copyFile(filePath, `${filePath}.bak`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

// ── openclaw.json ───────────────────────────────────────────────────────
export async function readOpenclawJson() {
  return (await readJson(getOpenclawJsonPath())) ?? {};
}

export async function writeOpenclawJson(data) {
  await writeJsonAtomic(getOpenclawJsonPath(), data);
}

// Apply a mutation to openclaw.json. Read-modify-write under a serialized
// promise chain so concurrent saves don't lose updates.
let cfgChain = Promise.resolve();
export function mutateOpenclawJson(fn) {
  const next = cfgChain.then(async () => {
    const cfg = await readOpenclawJson();
    cfg.channels ??= {};
    const result = await fn(cfg);
    await writeOpenclawJson(cfg);
    return result;
  });
  cfgChain = next.catch(() => {});
  return next;
}

// ── credentials/<channel>-<account>-allowFrom.json ──────────────────────
//
// File shape (matches the gateway):
//   { "version": 1, "allowFrom": ["12345", "67890"] }

export async function readAllowFrom(channel, account = 'default') {
  const data = await readJson(getAllowFromPath(channel, account));
  if (!data || !Array.isArray(data.allowFrom)) return [];
  return data.allowFrom.map(String);
}

export async function writeAllowFrom(channel, account, ids) {
  const cleaned = Array.from(new Set(
    (ids ?? [])
      .map((v) => String(v ?? '').trim())
      .filter(Boolean),
  ));
  const filePath = getAllowFromPath(channel, account);
  if (cleaned.length === 0) {
    // Match the gateway's behaviour of removing the file when empty.
    try { await fs.unlink(filePath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return [];
  }
  await writeJsonAtomic(filePath, { version: 1, allowFrom: cleaned });
  return cleaned;
}

// Parse the UI's comma-separated string into a clean array of IDs.
export function parseAllowedUsers(input) {
  if (Array.isArray(input)) return input.map(String);
  if (typeof input !== 'string') return [];
  return input.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

// ── ~/.openclaw/.env ────────────────────────────────────────────────────
//
// Managed-install secrets (Discord bot token, etc.) live here as plain
// KEY=value lines. We read/write the file atomically so a partial write
// can never leave the file half-formed.

function getDotEnvPath() {
  return path.join(getOpenclawHome(), '.env');
}

// Parse a dotenv-style file into a plain object. Lines that aren't
// KEY=value are preserved verbatim so comments + blank lines survive
// round-trips through writeDotEnvKey.
async function readDotEnvLines() {
  try {
    const raw = await fs.readFile(getDotEnvPath(), 'utf8');
    return raw.split(/\r?\n/);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function readDotEnvKey(name) {
  const lines = await readDotEnvLines();
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (m[1] !== name) continue;
    let v = m[2];
    // Strip matching surrounding quotes if present (matches dotenv loader).
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return null;
}

// Write a KEY=value pair, replacing an existing line if present, otherwise
// appending. Values containing whitespace or special chars get quoted.
let envChain = Promise.resolve();
export function writeDotEnvKey(name, value) {
  const next = envChain.then(async () => {
    const lines = await readDotEnvLines();
    const safeVal = /[\s"'#$`\\]/.test(value ?? '')
      ? `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : String(value ?? '');
    const newLine = `${name}=${safeVal}`;
    let replaced = false;
    const updated = lines.map((l) => {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && m[1] === name) { replaced = true; return newLine; }
      return l;
    });
    if (!replaced) {
      // Append, trimming any trailing blank lines first so we don't drift.
      while (updated.length && updated[updated.length - 1].trim() === '') updated.pop();
      updated.push(newLine);
    }
    // Always end with a newline (standard convention).
    let content = updated.join('\n');
    if (!content.endsWith('\n')) content += '\n';

    const filePath = getDotEnvPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try { await fs.copyFile(filePath, `${filePath}.bak`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, content, { mode: 0o600 });
    await fs.rename(tmp, filePath);
  });
  envChain = next.catch(() => {});
  return next;
}

export async function deleteDotEnvKey(name) {
  return writeDotEnvKey(name, '');   // simple approach: blank the value
}
