// Mission-control workspace. Internal drill-down nav:
//   orgs → org → board-group → board → task
// All sub-views live in this file to keep the surface compact; they share
// the existing PageHeader / page-table / dialog-overlay styles.

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, MessageSquare, Plus, Send, Trash2, X as XIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { mdComponents } from '../chat/markdown.jsx';
import { api, useApi, openSse } from '../../hooks/useApi.js';
import { ago } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function WorkspaceView({ onOpenSession }) {
  // Stack of nav frames: [{type:'orgs'} | {type:'org', id, name} | ...]
  const [stack, setStack] = useState([{ type: 'orgs' }]);
  const view = stack[stack.length - 1];
  const push  = (frame)  => setStack((s) => [...s, frame]);
  const popTo = (index)  => setStack((s) => s.slice(0, index + 1));

  return (
    <div className="ov-view">
      <Crumbs stack={stack} popTo={popTo} />
      {view.type === 'orgs'  && <OrgsList push={push} />}
      {view.type === 'org'   && <OrgDetail org={view} push={push} popTo={() => popTo(stack.length - 2)} />}
      {view.type === 'group' && <GroupDetail group={view} push={push} popTo={() => popTo(stack.length - 2)} />}
      {view.type === 'board' && <BoardDetail board={view} push={push} popTo={() => popTo(stack.length - 2)} onOpenSession={onOpenSession} />}
      {view.type === 'task'  && <TaskDetail task={view} popTo={() => popTo(stack.length - 2)} onOpenSession={onOpenSession} />}
    </div>
  );
}

// ── Approve / reject helpers (used in BoardDetail table + TaskDetail) ────
//
// Both flows go through the approvals API even when the user clicks a single
// button — that way the audit trail and SSE stream stay consistent. We auto-
// resolve the approval immediately and then patch the task status to mirror
// the final outcome.
async function approveTask(task, reason) {
  const text = (reason ?? '').trim() || 'Approved by reviewer.';
  const a = await api.post('/approvals', {
    boardId:       task.boardId,
    taskId:        task.id,
    agentId:       task.assigneeAgentId ?? undefined,
    actionType:    'task.complete',
    leadReasoning: text,
  });
  await api.patch(`/approvals/${a.id}`, { status: 'approved', resolvedBy: 'reviewer' });
  await api.patch(`/tasks/${task.id}`, { status: 'done' });
}
async function rejectTask(task, reason) {
  const text = (reason ?? '').trim() || 'Rejected by reviewer.';
  const a = await api.post('/approvals', {
    boardId:       task.boardId,
    taskId:        task.id,
    agentId:       task.assigneeAgentId ?? undefined,
    actionType:    'task.complete',
    leadReasoning: text,
  });
  await api.patch(`/approvals/${a.id}`, { status: 'rejected', resolvedBy: 'reviewer' });
  await api.patch(`/tasks/${task.id}`, { status: 'inbox' });
}

// ── Breadcrumbs ─────────────────────────────────────────────────────────

function Crumbs({ stack, popTo }) {
  return (
    <div className="ws-crumbs">
      {stack.map((f, i) => {
        const last = i === stack.length - 1;
        const label = labelFor(f);
        return (
          <span key={i} className="ws-crumb">
            {i > 0 && <ChevronRight size={12} className="ws-crumb-sep" />}
            {last
              ? <span className="ws-crumb-current">{label}</span>
              : <button className="ws-crumb-btn" onClick={() => popTo(i)}>{label}</button>}
          </span>
        );
      })}
    </div>
  );
}

function labelFor(f) {
  if (f.type === 'orgs')  return 'Workspace';
  if (f.type === 'org')   return f.name || 'Org';
  if (f.type === 'group') return f.name || 'Group';
  if (f.type === 'board') return f.name || 'Board';
  if (f.type === 'task')  return f.title || 'Task';
  return '?';
}

// ── Orgs list ───────────────────────────────────────────────────────────

function OrgsList({ push }) {
  const { data, loading, error, refresh } = useApi('/orgs');
  const [showCreate, setShowCreate] = useState(false);
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Workspace"
        subtitle="Organizations, board groups, boards, tasks."
        refreshing={loading}
        onRefresh={refresh}
        right={<button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New organization
        </button>}
      />

      <section className="ov-card">
        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !items.length && (
          <EmptyState title="No organizations yet" message="Create one to start grouping boards and tasks." />
        )}
        {!!items.length && (
          <ul className="ws-list">
            {items.map((org) => (
              <li key={org.id} className="ws-list-row" onClick={() => push({ type: 'org', id: org.id, name: org.name })}>
                <div className="ws-list-main">
                  <span className="page-strong">{org.name}</span>
                  <span className="page-muted">created {ago(new Date(org.createdAt).getTime())}</span>
                </div>
                <ChevronRight size={14} className="ws-list-chev" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCreate && (
        <CreateModal title="New organization" fields={[{ key: 'name', label: 'Name', required: true }]}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => {
            await api.post('/orgs', vals); setShowCreate(false); refresh();
          }} />
      )}
    </>
  );
}

// ── Org → board groups ──────────────────────────────────────────────────

function OrgDetail({ org, push, popTo }) {
  const { data, loading, error, refresh } = useApi(`/orgs/${org.id}/board-groups`);
  const [showCreate, setShowCreate] = useState(false);
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle="Board groups in this organization."
        refreshing={loading}
        onRefresh={refresh}
        right={<>
          <button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New group
          </button>
          <button className="ov-btn" onClick={async () => {
            if (!confirm('Delete organization and all boards/tasks within?')) return;
            await api.delete(`/orgs/${org.id}`); popTo();
          }}><Trash2 size={14} /></button>
        </>}
      />

      <section className="ov-card">
        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !items.length && <EmptyState title="No groups yet" />}
        {!!items.length && (
          <ul className="ws-list">
            {items.map((g) => (
              <li key={g.id} className="ws-list-row" onClick={() => push({ type: 'group', id: g.id, name: g.name })}>
                <div className="ws-list-main">
                  <span className="page-strong">{g.name}</span>
                  <span className="page-muted">created {ago(new Date(g.createdAt).getTime())}</span>
                </div>
                <ChevronRight size={14} className="ws-list-chev" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCreate && (
        <CreateModal title="New board group" fields={[{ key: 'name', label: 'Name', required: true }]}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => { await api.post(`/orgs/${org.id}/board-groups`, vals); setShowCreate(false); refresh(); }} />
      )}
    </>
  );
}

// ── Group → boards ──────────────────────────────────────────────────────

function GroupDetail({ group, push, popTo }) {
  const { data, loading, error, refresh } = useApi(`/board-groups/${group.id}/boards`);
  const [showCreate, setShowCreate] = useState(false);
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title={group.name}
        subtitle="Boards in this group."
        refreshing={loading}
        onRefresh={refresh}
        right={<>
          <button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New board
          </button>
          <button className="ov-btn" onClick={async () => {
            if (!confirm('Delete group and all boards/tasks within?')) return;
            await api.delete(`/board-groups/${group.id}`); popTo();
          }}><Trash2 size={14} /></button>
        </>}
      />

      <section className="ov-card">
        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !items.length && <EmptyState title="No boards yet" />}
        {!!items.length && (
          <ul className="ws-list">
            {items.map((b) => (
              <li key={b.id} className="ws-list-row" onClick={() => push({ type: 'board', id: b.id, name: b.name })}>
                <div className="ws-list-main">
                  <span className="page-strong">{b.name}</span>
                  <span className="page-muted">
                    {b.defaultAgentId ? <>agent <code className="page-mono">{b.defaultAgentId}</code></> : 'no default agent'}
                  </span>
                </div>
                <ChevronRight size={14} className="ws-list-chev" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCreate && (
        <CreateModal title="New board"
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'defaultAgentId', label: 'Default agent ID', placeholder: 'main' },
            { key: 'defaultInstructions', label: 'Default instructions', textarea: true },
          ]}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => { await api.post(`/board-groups/${group.id}/boards`, vals); setShowCreate(false); refresh(); }} />
      )}
    </>
  );
}

// ── Board → tasks ───────────────────────────────────────────────────────

function BoardDetail({ board, push, popTo, onOpenSession }) {
  const [tab, setTab] = useState('tasks');           // tasks | memory | webhooks
  const [taskView, setTaskView] = useState('kanban'); // kanban | table
  const { data, loading, error, refresh } = useApi(
    tab === 'tasks' ? `/boards/${board.id}/tasks` : null, [tab, board.id],
  );
  const agents = useApi(tab === 'tasks' ? '/agents' : null, [tab]);
  const [showCreate, setShowCreate] = useState(false);
  const items = data?.items ?? [];

  const agentOptions = (agents.data?.items ?? []).map((a) => ({
    value: `${a.kind ?? 'real'}:${a.id}`,
    label: `${a.name ?? a.id}${a.kind === 'virtual' ? ' (virtual)' : ''}`,
  }));

  const assign = async (id) => {
    await api.post(`/tasks/${id}/assign`, {});
    refresh();
  };
  const cancel = async (id) => { await api.post(`/tasks/${id}/cancel`, {}); refresh(); };
  const remove = async (id) => { if (confirm('Delete task?')) { await api.delete(`/tasks/${id}`); refresh(); } };

  // Tasks that *can* be run right now: in inbox status, with an assignee.
  // Used by the "Run all inbox" button so reviewers can drain the queue
  // without clicking each row.
  const runnable = useMemo(
    () => items.filter((t) => t.status === 'inbox' && t.assigneeAgentId),
    [items],
  );
  const [runningAll, setRunningAll] = useState(false);
  const runAllInbox = async () => {
    if (!runnable.length || runningAll) return;
    if (!confirm(`Run all ${runnable.length} inbox task(s) now?`)) return;
    setRunningAll(true);
    try {
      // Fire in parallel — the worker queue will serialise them.
      await Promise.all(runnable.map((t) => api.post(`/tasks/${t.id}/assign`, {}).catch(() => null)));
    } finally {
      setRunningAll(false);
      refresh();
    }
  };

  return (
    <>
      <PageHeader
        title={board.name}
        subtitle="Tasks, memory, and webhooks for this board."
        refreshing={loading}
        onRefresh={refresh}
        right={<>
          {tab === 'tasks' && runnable.length > 0 && (
            <button className="ov-btn" onClick={runAllInbox} disabled={runningAll}
              title="Assign every inbox task with an assignee">
              <Send size={13} /> {runningAll ? 'Running…' : `Run all inbox (${runnable.length})`}
            </button>
          )}
          {tab === 'tasks' && (
            <button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> New task
            </button>
          )}
          <button className="ov-btn" onClick={async () => {
            if (!confirm('Delete board and all tasks within?')) return;
            await api.delete(`/boards/${board.id}`); popTo();
          }}><Trash2 size={14} /></button>
        </>}
      />

      <div className="ws-tabs">
        {['tasks', 'memory', 'webhooks'].map((t) => (
          <button key={t}
            className={`ws-tab${tab === t ? ' ws-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'memory'   && <BoardMemory boardId={board.id} />}
      {tab === 'webhooks' && <BoardWebhooks boardId={board.id} />}
      {tab !== 'tasks'    && null}

      {tab === 'tasks' && (
        <div className="ws-view-toggle">
          <button className={`ws-view-btn${taskView === 'kanban' ? ' is-active' : ''}`} onClick={() => setTaskView('kanban')}>Kanban</button>
          <button className={`ws-view-btn${taskView === 'table'  ? ' is-active' : ''}`} onClick={() => setTaskView('table')}>Table</button>
        </div>
      )}

      {tab === 'tasks' && taskView === 'kanban' && (
        <KanbanBoard
          tasks={items}
          loading={loading}
          onPickTask={(t) => push({ type: 'task', id: t.id, title: t.title })}
          onAssign={assign}
          onCancel={cancel}
          onDelete={remove}
          onMoveStatus={async (id, status) => {
            await api.patch(`/tasks/${id}`, { status });
            refresh();
          }}
        />
      )}

      {tab === 'tasks' && taskView === 'table' && <section className="ov-card">
        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !items.length && <EmptyState title="No tasks yet" message="Create one to assign work to an agent." />}

        {!!items.length && (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} onClick={() => push({ type: 'task', id: t.id, title: t.title })} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="page-stack">
                        <span className="page-strong">{t.title}</span>
                        {t.description && <span className="page-muted ws-task-desc">{t.description}</span>}
                      </div>
                    </td>
                    <td>
                      <span className="ws-priority-pill" style={{ background: (PRIORITY_COLORS[t.priority] || '#7c3aed') + '22', color: PRIORITY_COLORS[t.priority] || '#7c3aed' }}>
                        {t.priority || 'medium'}
                      </span>
                    </td>
                    <td><span className={`status-chip status-chip--${statusClass(t.status)}`}>{t.status}</span></td>
                    <td>{t.assigneeAgentId ? <code className="page-mono">{t.assigneeAgentId}</code> : <span className="page-muted">—</span>}</td>
                    <td>{ago(new Date(t.updatedAt).getTime())}</td>
                    <td onClick={(e) => e.stopPropagation()} className="ws-task-actions">
                      {/* Review state: explicit Approve / Reject. The kanban
                          relies on drag-drop instead, but the table needs
                          obvious buttons so reviewers can act in one click. */}
                      {t.status === 'review' && (
                        <>
                          <button className="ov-btn ov-btn--primary" title="Approve & mark done"
                            onClick={async () => { await approveTask(t); refresh(); }}>
                            <Check size={12} /> Approve
                          </button>
                          <button className="ov-btn" title="Reject & send back to inbox"
                            onClick={async () => {
                              const reason = prompt('Reason for rejection (sent to the audit log):', '');
                              if (reason === null) return;
                              await rejectTask(t, reason); refresh();
                            }}>
                            <XIcon size={12} /> Reject
                          </button>
                        </>
                      )}
                      {t.status !== 'in_progress' && t.status !== 'review' && t.assigneeAgentId && (
                        <button className="ov-btn" title="Run" onClick={() => assign(t.id)}><Send size={13} /></button>
                      )}
                      {t.status === 'in_progress' && (
                        <button className="ov-btn" title="Cancel" onClick={() => cancel(t.id)}>Stop</button>
                      )}
                      <button className="row-action row-action--danger" title="Delete" onClick={() => remove(t.id)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {tab === 'tasks' && showCreate && (
        <CreateModal
          title="New task"
          fields={[
            { key: 'title',       label: 'Title', required: true },
            { key: 'description', label: 'Description (sent to the agent as the prompt)', textarea: true },
            {
              key: 'priority', label: 'Priority',
              select: [
                { value: 'low',    label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high',   label: 'High' },
                { value: 'urgent', label: 'Urgent' },
              ],
              placeholder: 'medium',
            },
            {
              key: 'assignee', label: 'Assign to',
              select: agentOptions, placeholder: 'Pick an agent',
            },
            {
              key: 'runAfter', label: 'Run immediately after create',
              checkbox: true, default: true,
            },
          ]}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => {
            const body = {
              title: vals.title,
              description: vals.description,
              priority: vals.priority || 'medium',
            };
            if (vals.assignee) {
              const [kind, id] = vals.assignee.split(':');
              body.assigneeAgentId = id; body.assigneeKind = kind;
            }
            const created = await api.post(`/boards/${board.id}/tasks`, body);
            if (vals.runAfter !== false && created?.id && body.assigneeAgentId) {
              try { await api.post(`/tasks/${created.id}/assign`, {}); } catch (_) { /* surfacing happens via list refresh */ }
            }
            setShowCreate(false); refresh();
          }}
        />
      )}
    </>
  );
}

// ── Kanban board (Tasks tab → Kanban view) ──────────────────────────────

const KANBAN_COLUMNS = [
  { id: 'inbox',       label: 'Inbox' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review',      label: 'Review' },
  { id: 'done',        label: 'Done' },
];

function KanbanBoard({ tasks, loading, onPickTask, onAssign, onCancel, onDelete, onMoveStatus }) {
  const grouped = useMemo(() => {
    const m = Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, []]));
    for (const t of tasks) {
      const col = m[t.status] ? t.status : 'inbox';
      m[col].push(t);
    }
    return m;
  }, [tasks]);

  const onDragStart = (e, task) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropTo = (e, status) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) onMoveStatus(id, status);
  };

  return (
    <div className="ws-kanban">
      {KANBAN_COLUMNS.map((col) => (
        <div key={col.id} className={`ws-kanban-col ws-kanban-col--${col.id}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDropTo(e, col.id)}
        >
          <div className="ws-kanban-head">
            <span className={`status-chip status-chip--${statusClass(col.id)}`}>{col.label}</span>
            <span className="page-muted">{grouped[col.id].length}</span>
          </div>
          <div className="ws-kanban-body">
            {grouped[col.id].length === 0 && !loading && (
              <div className="ws-kanban-empty">Drop tasks here</div>
            )}
            {grouped[col.id].map((t) => (
              <div key={t.id} className="ws-kanban-card"
                draggable onDragStart={(e) => onDragStart(e, t)}
                onClick={() => onPickTask(t)}
              >
                <div className="ws-kanban-card-head">
                  <span className="page-strong">{t.title}</span>
                  <span className="ws-priority-pill" style={{
                    background: (PRIORITY_COLORS[t.priority] || '#7c3aed') + '22',
                    color:      PRIORITY_COLORS[t.priority] || '#7c3aed',
                  }}>{t.priority || 'medium'}</span>
                </div>
                {t.description && <p className="ws-kanban-desc">{t.description}</p>}
                <div className="ws-kanban-foot">
                  {t.assigneeAgentId && <code className="page-mono">{t.assigneeAgentId}</code>}
                  <div className="ws-kanban-actions" onClick={(e) => e.stopPropagation()}>
                    {t.status !== 'in_progress' && t.assigneeAgentId && (
                      <button className="row-action" title="Run" onClick={() => onAssign(t.id)}><Send size={11} /></button>
                    )}
                    {t.status === 'in_progress' && (
                      <button className="row-action" title="Stop" onClick={() => onCancel(t.id)}>■</button>
                    )}
                    <button className="row-action row-action--danger" title="Delete" onClick={() => onDelete(t.id)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Board memory tab ────────────────────────────────────────────────────

function BoardMemory({ boardId }) {
  const { data, loading, refresh } = useApi(`/boards/${boardId}/memory`, [boardId]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy]   = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Sync draft when data arrives.
  useEffect(() => {
    if (data && draft === '' && data.content) setDraft(data.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/boards/${boardId}/memory`, { content: draft });
      setSavedAt(Date.now());
      refresh();
    } finally { setBusy(false); }
  };

  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Memory</h2>
        <p>Shared context for every task on this board. Agents can read this to stay aligned across runs.</p>
      </div>
      <textarea
        className="ov-input ws-memory"
        placeholder="Notes, project goals, repeat instructions… markdown is fine."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={loading || busy}
      />
      <div className="ws-memory-foot">
        <span className="page-muted">
          {savedAt
            ? `Saved ${ago(savedAt)}`
            : data?.updatedAt
            ? `Last saved ${ago(new Date(data.updatedAt).getTime())}`
            : 'Not saved yet'}
        </span>
        <button className="ov-btn ov-btn--primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

// ── Board webhooks tab ──────────────────────────────────────────────────

function BoardWebhooks({ boardId }) {
  const { data, loading, refresh } = useApi(`/boards/${boardId}/webhooks`, [boardId]);
  const [showCreate, setShowCreate] = useState(false);
  const items = data?.items ?? [];

  const remove = async (id) => {
    if (!confirm('Delete webhook?')) return;
    await api.delete(`/webhooks/${id}`); refresh();
  };
  const test = async (id) => {
    try { await api.post(`/webhooks/${id}/test`, {}); alert('Test queued — check the deliveries log.'); }
    catch (e) { alert(e.message); }
  };

  return (
    <>
      <section className="ov-card">
        <div className="ov-card-head ov-card-head--row">
          <div>
            <h2>Webhooks</h2>
            <p>Outbound HTTP fired on task lifecycle events (assigned, done, blocked, …).</p>
          </div>
          <button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New webhook
          </button>
        </div>

        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && !items.length && <EmptyState title="No webhooks" message="Add one to forward task events to Slack, Zapier, your service, etc." />}
        {!!items.length && (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Events</th>
                  <th>Active</th>
                  <th>Last delivery</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id}>
                    <td><code className="page-mono" style={{ wordBreak: 'break-all' }}>{w.url}</code></td>
                    <td>
                      {(w.events?.length ?? 0) === 0
                        ? <span className="page-pill">all</span>
                        : (w.events ?? []).map((ev) => <span key={ev} className="page-pill">{ev}</span>)
                      }
                    </td>
                    <td>
                      <span className={`status-chip status-chip--${w.active ? 'on' : 'paused'}`}>
                        {w.active ? 'on' : 'off'}
                      </span>
                    </td>
                    <td>{w.lastDeliveryAt ? ago(new Date(w.lastDeliveryAt).getTime()) : <span className="page-muted">never</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="ov-btn" onClick={() => test(w.id)}>Test</button>
                        <button className="row-action row-action--danger" onClick={() => remove(w.id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && (
        <CreateModal
          title="New webhook"
          fields={[
            { key: 'url',    label: 'URL',    required: true, placeholder: 'https://your.endpoint/path' },
            { key: 'secret', label: 'Secret (HMAC-SHA256, optional)' },
            { key: 'events', label: 'Events (comma-separated; blank = all)', placeholder: 'task.done, task.blocked' },
          ]}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => {
            await api.post(`/boards/${boardId}/webhooks`, {
              url:    vals.url,
              secret: vals.secret || undefined,
              events: vals.events ? vals.events.split(',').map((s) => s.trim()).filter(Boolean) : [],
              active: true,
            });
            setShowCreate(false); refresh();
          }}
        />
      )}
    </>
  );
}

// ── Task detail with live SSE transcript ────────────────────────────────

function TaskDetail({ task: hint, onOpenSession }) {
  const { data, loading, refresh } = useApi(`/tasks/${hint.id}`, [hint.id]);
  const [stream, setStream] = useState({ status: null, text: '' });

  // Open SSE when task is running OR on mount in case the worker is mid-run.
  useEffect(() => {
    const close = openSse(`/tasks/${hint.id}/stream`, (e) => {
      if (e.type === 'delta')  setStream((s) => ({ ...s, text: e.payload?.text ?? s.text }));
      if (e.type === 'status') {
        setStream((s) => ({
          ...s,
          status: e.payload?.status ?? s.status,
          text:   e.payload?.transcript ?? s.text,
        }));
        // Refresh DB-side fields when terminal events arrive.
        if (e.payload?.status && e.payload.status !== 'running') refresh();
      }
    });
    return close;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint.id]);

  if (loading && !data) return <EmptyState title="Loading task…" />;
  if (!data) return <EmptyState title="Task not found" />;

  const liveStatus     = stream.status ?? data.status;
  const liveTranscript = stream.text || data.lastResult || '';

  const assign = async () => { await api.post(`/tasks/${data.id}/assign`, {}); refresh(); };
  const cancel = async () => { await api.post(`/tasks/${data.id}/cancel`, {}); refresh(); };
  const doApprove = async () => { await approveTask(data); refresh(); };
  const doReject  = async () => {
    const reason = prompt('Reason for rejection (sent to the audit log):', '');
    if (reason === null) return;
    await rejectTask(data, reason);
    refresh();
  };

  return (
    <>
      <PageHeader
        title={data.title}
        subtitle={data.description ?? ''}
        refreshing={loading}
        onRefresh={refresh}
        right={<>
          {/* Review state gets prominent approve/reject. We hide the run
              button here so reviewers don't accidentally re-trigger. */}
          {liveStatus === 'review' && (
            <>
              <button className="ov-btn ov-btn--primary" onClick={doApprove}>
                <Check size={14} /> Approve
              </button>
              <button className="ov-btn" onClick={doReject}>
                <XIcon size={14} /> Reject
              </button>
            </>
          )}
          {liveStatus !== 'in_progress' && liveStatus !== 'review' && data.assigneeAgentId && (
            <button className="ov-btn ov-btn--primary" onClick={assign}><Send size={14} /> Run</button>
          )}
          {liveStatus === 'in_progress' && (
            <button className="ov-btn" onClick={cancel}>Stop</button>
          )}
          {/* Open the chat session this task ran in (same UX as cron history). */}
          {data.sessionKey && onOpenSession && (
            <button className="ov-btn"
              title="Open the chat session this task ran in"
              onClick={() => onOpenSession(data.sessionKey)}>
              <MessageSquare size={14} /> Open chat
            </button>
          )}
        </>}
      />

      <div className="ov-stat-row">
        <div className="ov-tile">
          <div className="ov-tile-title">STATUS</div>
          <div className="ov-tile-value">
            <span className={`status-chip status-chip--${statusClass(liveStatus)}`}>{liveStatus}</span>
          </div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">ASSIGNEE</div>
          <div className="ov-tile-value" style={{ fontSize: 14, fontFamily: 'monospace' }}>
            {data.assigneeAgentId ? `${data.assigneeAgentId} (${data.assigneeKind})` : '—'}
          </div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">RUNS</div>
          <div className="ov-tile-value">{data.runs?.length ?? 0}</div>
        </div>
      </div>

      <section className="ov-card">
        <div className="ov-card-head"><h2>Transcript</h2></div>
        {liveTranscript ? (
          <div className="ws-transcript-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {liveTranscript}
            </ReactMarkdown>
            {liveStatus === 'running' && <span className="cursor" />}
          </div>
        ) : (
          <EmptyState title="No output yet" message={data.assigneeAgentId ? 'Click Run to dispatch this task to its agent.' : 'Assign an agent to run this task.'} />
        )}
      </section>

      {data.runs?.length > 0 && (
        <section className="ov-card">
          <div className="ov-card-head"><h2>Run history</h2></div>
          <ul className="ws-list">
            {data.runs.map((r) => (
              <li key={r.id} className="ws-list-row">
                <div className="ws-list-main">
                  <span className="page-strong">
                    {r.stopReason ?? 'in-progress'}
                  </span>
                  <span className="page-muted">
                    {r.finishedAt ? `finished ${ago(new Date(r.finishedAt).getTime())}` : `started ${ago(new Date(r.startedAt).getTime())}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CommentsSection taskId={data.id} />
    </>
  );
}

// ── Comments thread (Task Detail) ───────────────────────────────────────

function CommentsSection({ taskId }) {
  const { data, loading, refresh } = useApi(`/tasks/${taskId}/comments`, [taskId]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const items = data?.items ?? [];

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await api.post(`/tasks/${taskId}/comments`, { body: text.trim() }); setText(''); refresh(); }
    finally { setBusy(false); }
  };

  return (
    <section className="ov-card">
      <div className="ov-card-head"><h2>Comments</h2></div>

      {loading && !items.length && <EmptyState title="Loading…" />}
      {!loading && !items.length && <EmptyState title="No comments yet" message="Discuss the task or leave notes for the agent." />}
      {!!items.length && (
        <ul className="ws-comments">
          {items.map((c) => (
            <li key={c.id} className="ws-comment">
              <div className="ws-comment-head">
                <span className="page-strong">{c.author}</span>
                <span className="page-muted">{ago(new Date(c.createdAt).getTime())}</span>
                <button className="ws-comment-del" onClick={async () => {
                  if (!confirm('Delete comment?')) return;
                  await api.delete(`/comments/${c.id}`); refresh();
                }} title="Delete">×</button>
              </div>
              <div className="ws-comment-body">{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="ws-comment-form">
        <textarea
          className="ov-input"
          rows={2}
          placeholder="Write a comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="ov-btn ov-btn--primary" disabled={busy || !text.trim()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </form>
    </section>
  );
}

// ── Reusable create modal ───────────────────────────────────────────────

function CreateModal({ title, fields, onSubmit, onCancel }) {
  // Seed defaults from any field with a `default`. Lets us prefill checkboxes
  // (e.g. "run immediately after create" defaulted to true).
  const [vals,  setVals]  = useState(() => {
    const init = {};
    for (const f of fields ?? []) if (f.default !== undefined) init[f.key] = f.default;
    return init;
  });
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }}>
        <h3>{title}</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try { await onSubmit(vals); }
          catch (x) { setErr(x.message); }
          finally   { setBusy(false); }
        }}>
          <div className="ov-form" style={{ marginTop: 14 }}>
            {fields.map((f) => (
              <div key={f.key} className="ov-field wide">
                {f.checkbox ? (
                  <label className="ov-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!vals[f.key]}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked })} />
                    <span>{f.label}</span>
                  </label>
                ) : (
                  <>
                    <label className="ov-label">{f.label}{f.required ? ' *' : ''}</label>
                    {f.select ? (
                      <select className="ov-input" value={vals[f.key] ?? ''}
                        onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
                        <option value="">{f.placeholder ?? '—'}</option>
                        {f.select.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    ) : f.textarea ? (
                      <textarea className="ov-input" rows={4} placeholder={f.placeholder ?? ''}
                        value={vals[f.key] ?? ''}
                        onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                    ) : (
                      <input className="ov-input" placeholder={f.placeholder ?? ''}
                        value={vals[f.key] ?? ''}
                        onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {err && <p className="page-toast page-toast--error" style={{ marginTop: 10 }}>{err}</p>}
          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button type="button" className="dialog-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="dialog-confirm" disabled={busy}>
              {busy ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Mission-control status enum: inbox | in_progress | review | done
function statusClass(s) {
  if (s === 'done')         return 'on';
  if (s === 'in_progress')  return 'running';
  if (s === 'review')       return 'paused';     // amber-ish
  if (s === 'inbox')        return 'paused';
  // legacy fallbacks
  if (s === 'pending')      return 'paused';
  if (s === 'running')      return 'running';
  if (s === 'blocked')      return 'error';
  if (s === 'cancelled')    return 'paused';
  return 'paused';
}

const PRIORITY_COLORS = { low: '#6b7280', medium: '#7c3aed', high: '#f59e0b', urgent: '#ef4444' };
