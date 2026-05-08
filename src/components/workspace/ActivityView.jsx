// Activity timeline. Filterable by event type / actor / since.

import { useMemo, useState } from 'react';
import { Activity, Search } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { ago } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

const EVENT_FILTERS = [
  { value: '',                label: 'All events' },
  { value: 'task.*',          label: 'Task lifecycle' },
  { value: 'task.assign-enqueued', label: 'Tasks assigned' },
  { value: 'task.done',       label: 'Tasks done' },
  { value: 'task.blocked',    label: 'Tasks blocked' },
  { value: 'approval.*',      label: 'Approvals' },
  { value: 'approval.created',label: 'Approvals created' },
  { value: 'approval.approved', label: 'Approvals approved' },
  { value: 'approval.rejected', label: 'Approvals rejected' },
  { value: 'comment.added',   label: 'Comments' },
  { value: 'board.memory.updated', label: 'Memory edits' },
];

export default function ActivityView() {
  const [type,  setType]  = useState('');
  const [since, setSince] = useState('');
  const [query, setQuery] = useState('');

  const params = new URLSearchParams();
  params.set('limit', '500');
  if (type)  params.set('type', type);
  if (since) params.set('since', since);

  const { data, loading, error, refresh } = useApi(`/activity?${params}`, [type, since]);
  const items = data?.items ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((e) =>
      (e.type ?? '').toLowerCase().includes(q) ||
      JSON.stringify(e.payload ?? {}).toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <div className="ov-view">
      <PageHeader
        title="Activity"
        subtitle="Audit timeline of every action across the workspace."
        refreshing={loading}
        onRefresh={refresh}
      />

      <section className="ov-card">
        <div className="page-toolbar">
          <div className="page-search" style={{ maxWidth: 320 }}>
            <Search size={14} />
            <input
              className="ov-input"
              placeholder="Search payloads…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="ov-input" value={type} onChange={(e) => setType(e.target.value)} style={{ width: 200 }}>
            {EVENT_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select className="ov-input" value={since} onChange={(e) => setSince(e.target.value)} style={{ width: 160 }}>
            <option value="">All time</option>
            <option value={dt(-1)}>Last hour</option>
            <option value={dt(-24)}>Last 24h</option>
            <option value={dt(-24 * 7)}>Last 7 days</option>
            <option value={dt(-24 * 30)}>Last 30 days</option>
          </select>
          <span className="page-count">{filtered.length} events</span>
        </div>

        {loading && !filtered.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !filtered.length && (
          <EmptyState icon={Activity} title="No activity matches" message={query || type ? 'Try widening the filter.' : 'Actions across the system will show here.'} />
        )}
        {!!filtered.length && (
          <ul className="activity-feed">
            {filtered.map((e) => (
              <li key={e.id} className="activity-row">
                <div className="activity-dot" />
                <div className="activity-body">
                  <div className="activity-head">
                    <code className="activity-type">{e.type}</code>
                    <span className="activity-time">{ago(new Date(e.createdAt).getTime())}</span>
                  </div>
                  {e.payload && (
                    <pre className="activity-payload">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function dt(hoursAgo) {
  return new Date(Date.now() + hoursAgo * 3600_000).toISOString();
}
