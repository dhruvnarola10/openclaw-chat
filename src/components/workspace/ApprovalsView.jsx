// Pending-approvals queue. Live-updates via SSE on /approvals/stream.

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, useApi, openSse } from '../../hooks/useApi.js';
import { ago } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function ApprovalsView({ onOpenTask }) {
  const [filter, setFilter] = useState('pending');
  const path = `/approvals${filter ? `?status=${filter}` : ''}`;
  const { data, loading, error, refresh } = useApi(path, [filter]);
  const items = data?.items ?? [];

  // Resolve agentId → human name once per page load. Approval rows then
  // render "📰 News Reporter" instead of "fab218fe-2f89-…".
  const agents = useApi('/agents', []);
  const agentMap = useMemo(() => {
    const m = new Map();
    for (const a of agents.data?.items ?? []) {
      m.set(a.id, { name: a.name ?? a.id, kind: a.kind ?? 'real', emoji: a.emoji });
    }
    return m;
  }, [agents.data]);

  useEffect(() => {
    const close = openSse('/approvals/stream', (e) => {
      if (e.type === 'approval') refresh();
    });
    return close;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolve = async (id, status) => {
    try { await api.patch(`/approvals/${id}`, { status }); refresh(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className="ov-view">
      <PageHeader
        title="Approvals"
        subtitle="Human-in-the-loop decisions waiting for review."
        refreshing={loading}
        onRefresh={refresh}
        right={<select className="ov-input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>}
      />

      <section className="ov-card">
        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !items.length && (
          <EmptyState title={filter === 'pending' ? 'No pending approvals' : 'No items'} />
        )}
        {!!items.length && (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Agent</th>
                  <th>Confidence</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const ag       = a.agentId ? agentMap.get(a.agentId) : null;
                  const openable = !!a.taskId && !!onOpenTask;
                  // Row click deep-links to the task. Action buttons stop
                  // propagation so Approve/Reject don't also navigate.
                  const onRowClick = openable
                    ? () => onOpenTask({ id: a.taskId, title: a.taskTitle })
                    : undefined;
                  return (
                    <tr key={a.id}
                        onClick={onRowClick}
                        style={openable ? { cursor: 'pointer' } : undefined}
                        className={openable ? 'page-row-clickable' : undefined}
                        title={openable ? 'Open task' : undefined}>
                      <td>
                        <div className="page-stack">
                          <span className="page-strong">
                            {a.taskTitle || <span className="page-muted">(no task)</span>}
                          </span>
                          <span className="page-muted" style={{ fontSize: 11.5 }}>
                            {a.leadReasoning
                              ? truncate(a.leadReasoning, 110)
                              : (a.payload?.reason ? truncate(a.payload.reason, 110) : a.actionType)}
                          </span>
                        </div>
                      </td>
                      <td>
                        {ag
                          ? <span>{ag.emoji ? `${ag.emoji} ` : ''}{ag.name}</span>
                          : (a.agentId
                              ? <code className="page-mono" title={a.agentId}>{a.agentId.slice(0, 8)}</code>
                              : <span className="page-muted">—</span>)}
                      </td>
                      <td>{a.confidence != null ? `${a.confidence}%` : <span className="page-muted">—</span>}</td>
                      <td>{ago(new Date(a.createdAt).getTime())}</td>
                      <td><span className={`status-chip status-chip--${a.status === 'pending' ? 'paused' : a.status === 'approved' ? 'on' : 'error'}`}>{a.status}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {a.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="row-action" title="Approve" onClick={() => resolve(a.id, 'approved')}>
                              <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                            </button>
                            <button className="row-action row-action--danger" title="Reject" onClick={() => resolve(a.id, 'rejected')}>
                              <XCircle size={14} />
                            </button>
                          </div>
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

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
