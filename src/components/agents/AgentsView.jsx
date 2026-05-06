// Agents page — every agent the gateway knows about, with the active one
// highlighted. Tries `agents.list` first, falls back to deriving the agent
// list from `node.list` (which is what OpenClaw's control UI does when
// `agents.list` isn't exposed) and `models.list` for model labels.
//
// Each row shows: name, ID, model, active session count, and a "Use" button
// that flips the local config.agentId to that agent.

import { useMemo } from 'react';
import { Bot, Check } from 'lucide-react';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { ago, parseSessionKey } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function AgentsView({ gateway, config }) {
  // Primary
  const agents = useGatewayResource({
    gateway,
    method:     'agents.list',
    intervalMs: 60_000,
  });

  // Fallback derivation
  const node = useGatewayResource({
    gateway,
    method:     'node.list',
    intervalMs: 60_000,
    enabled:    !!agents.error,
  });

  // Sessions for per-agent counts
  const sessions = useGatewayResource({
    gateway,
    method:     'sessions.list',
    intervalMs: 30_000,
  });

  const list = useMemo(() => {
    // Source 1: agents.list
    const a = agents.data?.agents ?? agents.data?.items
           ?? (Array.isArray(agents.data) ? agents.data : null);
    if (Array.isArray(a) && a.length) return a.map(normalizeAgent);

    // Source 2: derive from node.list — each node may publish its own agents
    const nodes = node.data?.nodes ?? node.data?.items
               ?? (Array.isArray(node.data) ? node.data : []);
    if (Array.isArray(nodes) && nodes.length) {
      const collected = [];
      for (const n of nodes) {
        const inner = n.agents ?? [];
        for (const ag of inner) {
          collected.push(normalizeAgent({
            ...ag,
            nodeId: n.id ?? n.name,
          }));
        }
      }
      if (collected.length) return collected;
    }
    return [];
  }, [agents.data, node.data]);

  // Count active sessions per agent.
  const sessionCounts = useMemo(() => {
    const m = new Map();
    const items = sessions.data?.items ?? sessions.data?.sessions
               ?? (Array.isArray(sessions.data) ? sessions.data : []);
    for (const s of items) {
      const parsed = parseSessionKey(s.key ?? '');
      m.set(parsed.agentId, (m.get(parsed.agentId) ?? 0) + 1);
    }
    return m;
  }, [sessions.data]);

  const activeAgentId = config?.agentId;
  const loading = agents.loading || node.loading || sessions.loading;
  const error   = agents.error && node.error ? `${agents.error}; ${node.error}` : '';

  const refresh = () => { agents.refresh(); node.refresh(); sessions.refresh(); };

  return (
    <div className="ov-view">
      <PageHeader
        title="Agents"
        subtitle="Active agents on this gateway."
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={refresh}
      />

      <div className="ov-stat-row">
        <div className="ov-tile">
          <div className="ov-tile-title">TOTAL</div>
          <div className="ov-tile-value">{list.length}</div>
        </div>
        <div className="ov-tile ov-tile--good">
          <div className="ov-tile-title">ACTIVE</div>
          <div className="ov-tile-value" style={{ fontSize: 14, fontFamily: 'monospace' }}>
            {activeAgentId || '—'}
          </div>
          <div className="ov-tile-hint">Selected for new chats</div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">SESSIONS</div>
          <div className="ov-tile-value">
            {[...sessionCounts.values()].reduce((a, b) => a + b, 0)}
          </div>
          <div className="ov-tile-hint">Across all agents</div>
        </div>
      </div>

      <section className="ov-card">
        {!list.length
          ? (gateway.status !== 'on'
              ? <EmptyState icon={Bot} title="Gateway offline" message="Connect from Overview." />
              : <EmptyState
                  icon={Bot}
                  title="No agents found"
                  message={
                    'The gateway didn\'t expose agents.list and the node.list payload didn\'t contain agent entries either.\n' +
                    'Some OpenClaw versions only expose the active agent through the agentId on each session.'
                  }
                  error={error}
                  onRetry={refresh}
                />)
          : (
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th className="num">Sessions</th>
                    <th>Last activity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const isActive = a.id === activeAgentId;
                    return (
                      <tr key={a.id} className={isActive ? 'page-row-active' : ''}>
                        <td>
                          <div className="page-stack">
                            <span className="page-strong">
                              {isActive && <Check size={12} style={{ marginRight: 6, color: '#22c55e' }} />}
                              {a.name || a.id}
                            </span>
                            <code className="page-mono">{a.id}</code>
                          </div>
                        </td>
                        <td>
                          {a.model
                            ? <code className="page-mono">{a.model}</code>
                            : <span className="page-muted">—</span>}
                        </td>
                        <td>
                          <span className={`status-chip status-chip--${a.status || 'on'}`}>
                            {a.status || 'on'}
                          </span>
                        </td>
                        <td className="num">{sessionCounts.get(a.id) ?? 0}</td>
                        <td>{a.lastActivity ? ago(a.lastActivity) : <span className="page-muted">—</span>}</td>
                        <td>
                          {!isActive && (
                            <button
                              className="ov-btn"
                              onClick={() => config?.setAgentId?.(a.id)}
                              title="Use this agent for new chats"
                            >
                              Use
                            </button>
                          )}
                          {isActive && (
                            <span className="page-pill" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                              Active
                            </span>
                          )}
                        </td>
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

function normalizeAgent(a) {
  return {
    id:           toStr(a.id ?? a.agentId ?? a.name),
    name:         toStr(a.name ?? a.label ?? a.id),
    model:        modelToStr(a.model ?? a.defaultModel ?? a.modelId ?? a.models),
    status:       toStr(a.status ?? a.state ?? (a.disabled ? 'disabled' : 'on')),
    description:  toStr(a.description),
    lastActivity: a.lastActivity ?? a.lastActivityAt ?? a.updatedAt,
    nodeId:       toStr(a.nodeId),
  };
}

// Some agent payloads ship `model` as an object — e.g.
//   { primary: "openai:gpt-4o", fallback: "anthropic:claude-3" }
// or a tagged variant. Pull out a printable label.
function modelToStr(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  if (typeof m === 'object') {
    return m.primary ?? m.id ?? m.name ?? m.model ?? m.default
        ?? (Array.isArray(m) ? m.join(', ') : '');
  }
  return String(m);
}

function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    return v.id ?? v.name ?? v.label ?? v.text ?? '';
  }
  return String(v);
}
