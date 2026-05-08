// Activity timeline. Filterable by event type / actor / since.
// Each row renders a human sentence ("Task X done · 12s"); raw JSON is
// intentionally hidden from the UI.

import { useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, FileText,
  MessageCircle, PlayCircle, Search, X as XIcon,
} from 'lucide-react';
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

  // Resolve agent-id → human name once per page load. Activity rows then
  // render "📰 News Reporter" instead of "fab218fe-2f89-...".
  const agents = useApi('/agents', []);
  const agentMap = useMemo(() => {
    const m = new Map();
    for (const a of agents.data?.items ?? []) {
      m.set(a.id, { name: a.name ?? a.id, kind: a.kind ?? 'real', emoji: a.emoji });
    }
    return m;
  }, [agents.data]);

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
              <ActivityRow key={e.id} event={e} agentMap={agentMap} />
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

// ── Single activity row — human sentence only, no JSON drawer ──────────
function ActivityRow({ event, agentMap }) {
  const summary = useMemo(() => formatActivity(event, agentMap), [event, agentMap]);
  const Icon = summary.icon;
  return (
    <li className="activity-row">
      <div className={`activity-icon activity-icon--${summary.tone}`}>
        <Icon size={14} />
      </div>
      <div className="activity-body">
        <div className="activity-head">
          <span className="activity-message">{summary.message}</span>
          <span className="activity-time">{ago(new Date(event.createdAt).getTime())}</span>
        </div>
        {summary.detail && <div className="activity-detail">{summary.detail}</div>}
      </div>
    </li>
  );
}

// ── Event-type → human sentence ─────────────────────────────────────────
//
// Returns { icon, tone, message, detail? }. `tone` controls the dot colour
// (good/bad/warn/info). Anything we don't recognise falls through to a
// generic "<type>" rendering with the JSON drawer still available.
function formatActivity(event, agentMap) {
  const t = event.type ?? '';
  const p = event.payload ?? {};

  const agent = (id) => {
    if (!id) return null;
    const meta = agentMap?.get(id);
    if (!meta) return <ShortId id={id} />;
    return <span className="activity-pill">{meta.emoji ? meta.emoji + ' ' : ''}{meta.name}</span>;
  };
  const taskRef = (id) => id ? <ShortId id={id} prefix="task" /> : null;

  // Task lifecycle ────────────────────────────────────────────────────────
  if (t === 'task.assign-enqueued') {
    return {
      icon: PlayCircle, tone: 'info',
      message: <>Task {taskRef(p.taskId)} queued for {agent(p.agentId)} <span className="activity-muted">({p.kind ?? 'real'})</span></>,
    };
  }
  if (t === 'task.in_progress') {
    return {
      icon: PlayCircle, tone: 'info',
      message: <>Task {taskRef(p.taskId)} started running</>,
    };
  }
  if (t === 'task.review') {
    return {
      icon: AlertTriangle, tone: 'warn',
      message: <>Task {taskRef(p.taskId)} finished — awaiting review</>,
    };
  }
  if (t === 'task.done') {
    return {
      icon: CheckCircle2, tone: 'good',
      message: <>Task {taskRef(p.taskId)} completed</>,
    };
  }
  if (t === 'task.inbox' || t === 'task.blocked') {
    return {
      icon: AlertTriangle, tone: 'bad',
      message: <>Task {taskRef(p.taskId)} {t === 'task.blocked' ? 'blocked' : 'reset to inbox'}</>,
      detail:  p.error ? <span className="activity-err">{String(p.error)}</span> : null,
    };
  }

  // Approvals ─────────────────────────────────────────────────────────────
  if (t === 'approval.created') {
    const n = (p.taskIds?.length ?? (p.taskId ? 1 : 0));
    return {
      icon: AlertTriangle, tone: 'warn',
      message: <>Approval requested by {agent(p.agentId)} for {n} task{n === 1 ? '' : 's'} <span className="activity-muted">— {p.actionType ?? 'action'}</span></>,
    };
  }
  if (t === 'approval.approved') {
    return {
      icon: CheckCircle2, tone: 'good',
      message: <>Approval ✓ approved {p.taskId ? <>(task {taskRef(p.taskId)})</> : null}</>,
    };
  }
  if (t === 'approval.rejected') {
    return {
      icon: XIcon, tone: 'bad',
      message: <>Approval ✗ rejected {p.taskId ? <>(task {taskRef(p.taskId)})</> : null}</>,
    };
  }

  // Comments + memory ─────────────────────────────────────────────────────
  if (t === 'comment.added') {
    return {
      icon: MessageCircle, tone: 'info',
      message: <><strong>{p.author ?? 'someone'}</strong> commented on task {taskRef(p.taskId)}</>,
    };
  }
  if (t === 'board.memory.updated') {
    return {
      icon: FileText, tone: 'info',
      message: <>Board memory updated</>,
    };
  }

  // Webhooks ──────────────────────────────────────────────────────────────
  if (t.startsWith('webhook.')) {
    const ok = t === 'webhook.delivered';
    return {
      icon: ok ? CheckCircle2 : AlertTriangle,
      tone: ok ? 'good' : 'bad',
      message: <>Webhook {t.split('.')[1]} {p.url ? <>→ <code className="page-mono">{p.url}</code></> : null}</>,
    };
  }

  // Fallback ──────────────────────────────────────────────────────────────
  return {
    icon: Activity, tone: 'info',
    message: <code className="activity-type-fallback">{t || 'event'}</code>,
  };
}

// Render a UUID as a clipped monospace pill with the full id as a tooltip.
function ShortId({ id, prefix }) {
  const short = String(id).slice(0, 8);
  return (
    <code className="activity-pill activity-pill--mono" title={id}>
      {prefix ? `${prefix}:${short}` : short}
    </code>
  );
}
