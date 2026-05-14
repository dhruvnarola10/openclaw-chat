// Top-level Usage dashboard.
// Fetches `sessions.usage` (or falls back to `usage.cost`), parses the
// shape that OpenClaw actually returns, and renders the metric cards.
// See src/api/usage.js for the method names and src/api/overview.js for
// docs cross-reference.

import { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { fetchUsage, USAGE_PRIMARY_METHOD, USAGE_FALLBACK_METHOD } from '../../api/usage.js';
import { compactNumber } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import UsageFilters, { presetToDates } from './UsageFilters.jsx';
import UsageOverview from './UsageOverview.jsx';

export default function UsageView({ gateway }) {
  const [{ from, to }, setRange] = useState(() => presetToDates(6));
  const [rangeId, setRangeId]    = useState('7d');
  const [mode, setMode]          = useState('tokens');
  const [data, setData]          = useState(null);
  const [source, setSource]      = useState('');
  const [error, setError]        = useState('');
  const [loading, setLoading]    = useState(false);

  const load = useCallback(async () => {
    if (gateway?.status !== 'on') {
      setError('Gateway is not connected. Connect from the Overview page first.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { source: src, payload } = await fetchUsage({
        gateway, params: { from, to },
      });
      setSource(src);
      setData(normalizeUsage(payload));
    } catch (e) {
      setError(e.message);
      setData(null);
      setSource('');
    } finally {
      setLoading(false);
    }
  }, [from, to, gateway]);

  useEffect(() => { load(); }, [load]);

  const onRangeChange = (id, days) => {
    setRangeId(id);
    setRange(presetToDates(days));
  };

  return (
    <div className="ov-view">
      <PageHeader
        title="Usage"
        subtitle="See where tokens go, when sessions spike, and what drives cost."
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={load}
      />

      <UsageFilters
        range={rangeId}
        from={from} to={to}
        mode={mode}
        loading={loading}
        onRangeChange={onRangeChange}
        onFromChange={(v) => { setRangeId(''); setRange((r) => ({ ...r, from: v })); }}
        onToChange={(v)   => { setRangeId(''); setRange((r) => ({ ...r, to: v })); }}
        onModeChange={setMode}
        onRefresh={load}
        totals={{ tokens: data?.totalTokens, cost: data?.totalCost }}
        sessionCount={data?.sessions}
      />

      {loading && !data && (
        <div className="usage-loading">
          <span className="hist-spinner" /> Loading usage data…
        </div>
      )}

      {!loading && error && <UsageUnavailable error={error} onRetry={load} />}

      {!error && data && <UsageOverview data={data} />}

      {!error && data && (
        <p className="usage-footnote">
          Showing {compactNumber(data.messages ?? 0)} messages from {from} to {to} · source: <code>{source}</code>
        </p>
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function UsageUnavailable({ error, onRetry }) {
  return (
    <div className="usage-empty">
      <div className="usage-empty-icon"><BarChart3 size={28} /></div>
      <h3>Couldn't load usage data</h3>
      <p>The gateway didn't return usable data for this date range.</p>
      <details className="usage-empty-details">
        <summary>What was tried</summary>
        <p><strong>WebSocket methods:</strong></p>
        <ul>
          <li><code>{USAGE_PRIMARY_METHOD}</code> (primary)</li>
          <li><code>{USAGE_FALLBACK_METHOD}</code> (fallback)</li>
        </ul>
        <p><strong>Error:</strong></p>
        <pre className="usage-empty-pre">{error}</pre>
      </details>
      <p className="usage-empty-howto">
        <strong>Common causes:</strong> the gateway is on a version older than the
        usage subsystem, the agent has no recorded activity in this range, or
        the connection dropped mid-request. Try Refresh or pick a wider range.
      </p>
      <button className="refresh-pill" onClick={onRetry}>Retry</button>
    </div>
  );
}

// ── Payload normaliser ──────────────────────────────────────────────────
//
// `sessions.usage` shape (confirmed against openclaw_exp source):
//   {
//     updatedAt, startDate, endDate,
//     sessions: SessionUsageEntry[],
//     totals:   CostUsageTotals,                 // input/output/cacheRead/cacheWrite/totalTokens/totalCost/...
//     aggregates: {
//       messages: { total, user, assistant, toolCalls, toolResults, errors },
//       tools:    { totalCalls, uniqueTools, tools: [{name, count}] },
//       byModel:    [{ provider, model, count, totals }],
//       byProvider: [{ provider, count, totals }],
//       byAgent:    [{ agentId, totals }],
//       byChannel:  [{ channel, totals }],
//       latency?:   { count, avgMs, p95Ms, minMs, maxMs },
//       daily:      [{ date, tokens, cost, messages, toolCalls, errors }]
//     }
//   }
//
// `usage.cost` is lighter — { totals, daily } only — so several fields
// degrade to null when that's the source.

function normalizeUsage(payload = {}) {
  const totals     = payload.totals     ?? {};
  const aggregates = payload.aggregates ?? {};
  const messages   = aggregates.messages ?? {};
  const toolsAgg   = aggregates.tools    ?? {};
  const sessions   = Array.isArray(payload.sessions) ? payload.sessions : [];
  const days       = Array.isArray(aggregates.daily) ? aggregates.daily : (payload.daily ?? []);

  // Rate of throughput: tokens/min, cost/min over the active window.
  const totalTokens = num(totals.totalTokens);
  const totalCost   = num(totals.totalCost);
  const totalMs     = days.reduce((acc, d) => acc + (d.durationMs ?? 0), 0);
  const fallbackMin = Math.max(1, days.length * 24 * 60);
  const minutes     = totalMs ? totalMs / 60000 : fallbackMin;

  // Cache hit rate over the totals — server reports tokens, derive ratio.
  const cacheRead   = num(totals.cacheRead) ?? 0;
  const cacheWrite  = num(totals.cacheWrite) ?? 0;
  const inputTokens = num(totals.input) ?? 0;
  const cacheRate   = (inputTokens + cacheRead + cacheWrite) > 0
    ? cacheRead / (inputTokens + cacheRead + cacheWrite)
    : null;

  return {
    messages:          num(messages.total),
    userMessages:      num(messages.user),
    assistantMessages: num(messages.assistant),

    totalTokens,
    promptTokens:      num(totals.input),
    cachedTokens:      cacheRead,
    cacheHitRate:      cacheRate,

    tokensPerMin:      totalTokens != null ? totalTokens / minutes : null,
    costPerMin:        totalCost   != null ? totalCost   / minutes : null,

    toolCalls:         num(toolsAgg.totalCalls ?? messages.toolCalls),
    uniqueTools:       num(toolsAgg.uniqueTools),
    toolErrors:        num(messages.errors),

    avgTokensPerMsg:   (totalTokens && messages.total) ? totalTokens / messages.total : null,
    avgCostPerMsg:     (totalCost   && messages.total) ? totalCost   / messages.total : null,
    totalCost,

    errors:            num(messages.errors),
    errorRate:         (messages.total && messages.errors)
                          ? messages.errors / messages.total : null,

    sessions:          sessions.length,
    activeSessions:    sessions.filter((s) => s.usage).length,

    topModels:    rowsForBreakdown(aggregates.byModel,    (r) => r.model    ?? r.provider ?? '—'),
    topProviders: rowsForBreakdown(aggregates.byProvider, (r) => r.provider ?? '—'),
    topAgents:    rowsForBreakdown(aggregates.byAgent,    (r) => r.agentId  ?? '—'),
    topChannels:  rowsForBreakdown(aggregates.byChannel,  (r) => r.channel  ?? '—'),

    topTools: (toolsAgg.tools ?? []).map((t) => ({
      id:    t.name,
      name:  t.name,
      value: num(t.count),
      count: num(t.count),
    })),

    peakErrorDays: days
      .map((d) => ({
        id:    d.date,
        name:  d.date,
        value: d.messages ? (d.errors ?? 0) / d.messages : 0,
        sub:   `${d.errors ?? 0} errors · ${d.messages ?? 0} msgs`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
}

function rowsForBreakdown(rows, nameOf) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r, i) => ({
    id:    nameOf(r) || i,
    name:  nameOf(r),
    value: num(r.totals?.totalCost),
    sub:   `${compactNumber(num(r.totals?.totalTokens) ?? 0)} tokens · ${r.count ?? 0} msgs`,
  }));
}

function num(v) { return v == null ? null : Number(v); }
