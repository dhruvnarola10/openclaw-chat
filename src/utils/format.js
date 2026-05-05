// Pure formatting / id helpers. No React, no DOM.

export const genId = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

export const ago = (ts) => {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`;
  return `${Math.round(d / 86400000)}d ago`;
};

const relDay = (ts) => {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const t = new Date();   t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7)  return 'Previous 7 days';
  if (diff <= 30) return 'Previous 30 days';
  return 'Older';
};

export function groupThreads(threads) {
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
  const map = {};
  for (const t of [...threads].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const g = relDay(t.updatedAt);
    (map[g] ??= []).push(t);
  }
  return order.filter((k) => map[k]).map((k) => [k, map[k]]);
}

// "agent:<agentId>:<channel>:<peer>" → { agentId, channel, peer }
export function parseSessionKey(key = '') {
  const parts = key.split(':');
  if (parts[0] !== 'agent' || parts.length < 3) {
    return { agentId: '?', channel: 'unknown', peer: key };
  }
  return {
    agentId: parts[1],
    channel: parts[2],
    peer: parts.slice(3).join(':') || '—',
  };
}

// Compact number — 1234 → 1.2K, 12345 → 12.3K, 1234567 → 1.2M
export function compactNumber(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export const formatCost = (n) =>
  n == null ? '—' : '$' + Number(n).toFixed(4);

export const formatPct = (n) =>
  n == null ? '—' : `${(n * 100).toFixed(2).replace(/\.00$/, '')}%`;

// YYYY-MM-DD → local date or vice versa
export const toIsoDate = (d) => new Date(d).toISOString().slice(0, 10);
