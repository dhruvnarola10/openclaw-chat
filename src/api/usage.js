// Usage / metrics fetcher.
//
// OpenClaw exposes usage data over the WebSocket gateway only — there is
// no JSON HTTP equivalent (the only HTTP metrics path is the Prometheus
// exposition at /api/diagnostics/prometheus, which we don't parse).
//
// Confirmed methods (from openclaw_exp/src/gateway/server-methods/usage.ts):
//   • sessions.usage — full snapshot: totals, aggregates, per-session breakdown
//   • usage.cost     — daily cost/tokens (lighter, used as fallback)
//   • usage.status   — live provider quota windows
//
// Each method takes { startDate, endDate } in "YYYY-MM-DD" plus an optional
// `mode: "utc" | "gateway" | "specific"` (we send "utc" — the default).

const REQ_TIMEOUT_MS = 8000;

function withTimeout(p, ms = REQ_TIMEOUT_MS) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

// Coerce arbitrary date input ("2025-11-01" / Date / number) to "YYYY-MM-DD"
// — we only ever send strict ISO date strings, no string interpolation that
// could carry server-side state, so injection isn't a concern.
function toDate(d) {
  if (!d) return undefined;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(d).toISOString().slice(0, 10);
}

export const USAGE_PRIMARY_METHOD  = 'sessions.usage';
export const USAGE_FALLBACK_METHOD = 'usage.cost';

/**
 * Fetch usage for a date range. Returns { source, payload } where payload
 * is the raw server response. Throws on full failure with a descriptive message.
 */
export async function fetchUsage({ gateway, params }) {
  if (!gateway?.request) throw new Error('Gateway not available');
  if (gateway.status !== 'on') {
    throw new Error('Gateway is not connected — open the WebSocket first.');
  }

  const startDate = toDate(params?.from);
  const endDate   = toDate(params?.to);
  const wsParams  = {
    ...(startDate && { startDate }),
    ...(endDate   && { endDate }),
    mode: 'utc',
    limit: 200,
  };

  // Try sessions.usage first — it has everything (totals + aggregates).
  try {
    const payload = await withTimeout(gateway.request(USAGE_PRIMARY_METHOD, wsParams));
    return { source: `ws:${USAGE_PRIMARY_METHOD}`, payload };
  } catch (e1) {
    // Fall back to usage.cost — same date params but lighter response.
    try {
      const payload = await withTimeout(gateway.request(USAGE_FALLBACK_METHOD, wsParams));
      return { source: `ws:${USAGE_FALLBACK_METHOD}`, payload };
    } catch (e2) {
      throw new Error(
        `${USAGE_PRIMARY_METHOD}: ${e1.message}; ${USAGE_FALLBACK_METHOD}: ${e2.message}`
      );
    }
  }
}

// Live provider quota windows (Anthropic 5h/weekly, Codex limits, etc.)
export async function fetchUsageStatus({ gateway }) {
  if (!gateway?.request) throw new Error('Gateway not available');
  if (gateway.status !== 'on') return null;
  try {
    return await withTimeout(gateway.request('usage.status', {}));
  } catch {
    return null;
  }
}
