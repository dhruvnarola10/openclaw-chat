// Sessions page — full table of every session the gateway is tracking,
// with the per-session usage snapshot pulled from `sessions.usage`.

import { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { ago, compactNumber, parseSessionKey } from '../../utils/format.js';
import { channelMeta } from '../../utils/channels.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function SessionsView({ gateway }) {
  const [query, setQuery] = useState('');

  const list = useGatewayResource({
    gateway,
    method:     'sessions.list',
    intervalMs: 20_000,
  });

  const usage = useGatewayResource({
    gateway,
    method:     'sessions.usage',
    params:     { mode: 'utc', limit: 200 },
    intervalMs: 60_000,
  });

  const rows = useMemo(() => {
    const baseList = list.data?.items ?? list.data?.sessions
                   ?? (Array.isArray(list.data) ? list.data : []);
    const usageList = usage.data?.sessions ?? [];
    const usageByKey = new Map(usageList.map((u) => [u.key, u]));

    const merged = baseList.map((s) => {
      const u = usageByKey.get(s.key);
      const parsed = parseSessionKey(s.key ?? '');
      return {
        key:        s.key ?? '',
        agent:      parsed.agentId,
        channel:    s.channel ?? parsed.channel,
        peer:       s.displayName ?? parsed.peer,
        model:      u?.model ?? u?.modelOverride ?? s.model ?? null,
        provider:   u?.modelProvider ?? null,
        kind:       s.kind,
        updatedAt:  s.updatedAt ?? u?.updatedAt,
        cost:       u?.usage?.totalCost ?? null,
        tokens:     u?.usage?.totalTokens ?? null,
        messages:   u?.usage?.messageCounts?.total ?? null,
        firstAt:    u?.usage?.firstActivity ?? null,
      };
    });

    if (!query.trim()) return merged;
    const q = query.toLowerCase();
    return merged.filter((r) =>
      (r.peer || '').toLowerCase().includes(q) ||
      (r.key  || '').toLowerCase().includes(q) ||
      (r.channel || '').toLowerCase().includes(q) ||
      (r.model   || '').toLowerCase().includes(q)
    );
  }, [list.data, usage.data, query]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [rows]
  );

  const refresh = () => { list.refresh(); usage.refresh(); };
  const loading = list.loading || usage.loading;
  const error   = list.error || usage.error;

  return (
    <div className="ov-view">
      <PageHeader
        title="Sessions"
        subtitle="Conversations the gateway is tracking across every channel."
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={refresh}
      />

      <section className="ov-card">
        <div className="page-toolbar">
          <div className="page-search">
            <Search size={14} />
            <input
              className="ov-input"
              placeholder="Filter by peer, key, channel, or model…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="page-count">
            {sorted.length} session{sorted.length === 1 ? '' : 's'}
          </span>
        </div>

        {sorted.length === 0
          ? (gateway.status !== 'on'
              ? <EmptyState icon={Users} title="Gateway offline" message="Connect from Overview." />
              : (loading
                  ? <EmptyState icon={Users} title="Loading sessions…" />
                  : <EmptyState icon={Users} title="No sessions yet" message={error || 'Start a chat to see it here.'} />))
          : (
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Peer / Key</th>
                    <th>Model</th>
                    <th className="num">Messages</th>
                    <th className="num">Tokens</th>
                    <th className="num">Cost</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const meta = channelMeta(r.channel);
                    return (
                      <tr key={r.key}>
                        <td>
                          <span className="page-pill">{meta.label}</span>
                        </td>
                        <td>
                          <div className="page-stack">
                            <span className="page-strong">{r.peer || '—'}</span>
                            <code className="page-mono">{r.key}</code>
                          </div>
                        </td>
                        <td>
                          {r.model
                            ? <code className="page-mono">{r.model}</code>
                            : <span className="page-muted">—</span>}
                        </td>
                        <td className="num">{r.messages != null ? compactNumber(r.messages) : '—'}</td>
                        <td className="num">{r.tokens != null ? compactNumber(r.tokens) : '—'}</td>
                        <td className="num">{r.cost != null ? '$' + r.cost.toFixed(4) : '—'}</td>
                        <td>{r.updatedAt ? ago(r.updatedAt) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
