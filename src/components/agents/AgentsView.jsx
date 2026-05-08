// Agents page. Two kinds of agents:
//   • REAL    — defined in the OpenClaw gateway (openclaw.json). The backend
//               proxies create/update/delete to the gateway's agents.* RPCs.
//   • VIRTUAL — DB rows that wrap a real agent with custom instructions,
//               communication style, board assignment, etc.
//
// GET /api/v1/agents returns { items: [...], defaultId } where each item has
// `kind: "real" | "virtual"`.

import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, useApi } from '../../hooks/useApi.js';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { parseSessionKey } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function AgentsView({ gateway, config }) {
  const { data, loading, error, refresh } = useApi('/agents');
  const items = data?.items ?? [];

  const [creating, setCreating]   = useState(false);
  const [editing,  setEditing]    = useState(null);     // virtual agent row to edit
  const [busyId,   setBusyId]     = useState(null);
  const [toast,    setToast]      = useState('');

  // Live session counts (still come from the gateway).
  const sessions = useGatewayResource({
    gateway, method: 'sessions.list', intervalMs: 30_000,
  });
  const sessionCounts = useMemo(() => {
    const m = new Map();
    const list = sessions.data?.items ?? sessions.data?.sessions
              ?? (Array.isArray(sessions.data) ? sessions.data : []);
    for (const s of list) {
      const parsed = parseSessionKey(s.key ?? '');
      m.set(parsed.agentId, (m.get(parsed.agentId) ?? 0) + 1);
    }
    return m;
  }, [sessions.data]);

  const realAgents = items.filter((a) => a.kind !== 'virtual');
  const activeAgentId = config?.agentId;

  const remove = async (a) => {
    const isReal = a.kind === 'real';
    const msg = isReal
      ? `Delete real agent "${a.name || a.id}" from the gateway? This rewrites openclaw.json.`
      : 'Delete this virtual agent?';
    if (!confirm(msg)) return;
    setBusyId(a.id); setToast('');
    try {
      if (isReal) await api.delete(`/agents/real/${a.id}`);
      else        await api.delete(`/agents/${a.id}`);
      refresh();
    } catch (e) { setToast(e.message); }
    finally   { setBusyId(null); }
  };

  return (
    <div className="ov-view">
      <PageHeader
        title="Agents"
        subtitle="Real agents from your gateway plus virtual personas you create here."
        gatewayStatus={gateway?.status}
        refreshing={loading}
        onRefresh={refresh}
        right={
          <button className="ov-btn ov-btn--primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> New agent
          </button>
        }
      />

      {toast && (
        <div className="page-toast page-toast--error">
          {toast}
          <button className="page-toast-close" onClick={() => setToast('')}>×</button>
        </div>
      )}

      <div className="ov-stat-row">
        <div className="ov-tile">
          <div className="ov-tile-title">TOTAL</div>
          <div className="ov-tile-value">{items.length}</div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">REAL</div>
          <div className="ov-tile-value">{realAgents.length}</div>
          <div className="ov-tile-hint">From gateway config</div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">VIRTUAL</div>
          <div className="ov-tile-value">{items.length - realAgents.length}</div>
          <div className="ov-tile-hint">Personas you defined</div>
        </div>
        <div className="ov-tile ov-tile--good">
          <div className="ov-tile-title">ACTIVE FOR NEW CHATS</div>
          <div className="ov-tile-value" style={{ fontSize: 14, fontFamily: 'monospace' }}>
            {activeAgentId || '—'}
          </div>
        </div>
      </div>

      <section className="ov-card">
        {loading && !items.length && <EmptyState title="Loading…" />}
        {!loading && error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
        {!loading && !error && !items.length && (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            message="Add a virtual persona, or configure real agents in your gateway's openclaw.json."
          />
        )}
        {!!items.length && (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Kind</th>
                  <th>Base / Model</th>
                  <th className="num">Sessions</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const isActive = a.id === activeAgentId
                                || a.baseAgentId === activeAgentId;
                  const isVirtual = a.kind === 'virtual';
                  return (
                    <tr key={a.id} className={isActive ? 'page-row-active' : ''}>
                      <td>
                        <div className="page-stack">
                          <span className="page-strong">
                            {isActive && <Check size={12} style={{ marginRight: 6, color: '#22c55e' }} />}
                            {a.name || a.id}
                          </span>
                          {a.description && <span className="page-muted">{a.description}</span>}
                          <code className="page-mono">{a.id}</code>
                        </div>
                      </td>
                      <td>
                        <span className={`status-chip status-chip--${isVirtual ? 'paused' : 'on'}`}>
                          {a.kind ?? 'real'}
                        </span>
                      </td>
                      <td>
                        {isVirtual && a.baseAgentId
                          ? <code className="page-mono">{a.baseAgentId}</code>
                          : a.model
                          ? <code className="page-mono">{a.model}</code>
                          : <span className="page-muted">—</span>}
                      </td>
                      <td className="num">
                        {sessionCounts.get(a.id) ?? sessionCounts.get(a.baseAgentId) ?? 0}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {!isActive && !isVirtual && (
                            <button className="ov-btn" onClick={() => config?.setAgentId?.(a.id)}
                              title="Use this agent for new chats">Use</button>
                          )}
                          <button className="row-action" onClick={() => setEditing(a)} title="Edit">
                            <Pencil size={12} />
                          </button>
                          <button className="row-action row-action--danger"
                            disabled={busyId === a.id}
                            onClick={() => remove(a)} title="Delete">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <AgentModal
          title="New agent"
          gateway={gateway}
          realAgents={realAgents}
          onCancel={() => setCreating(false)}
          onSubmit={async ({ kind, ...vals }) => {
            if (kind === 'real') await api.post('/agents/real', vals);
            else                 await api.post('/agents', vals);
            setCreating(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <AgentModal
          title={editing.kind === 'real' ? 'Edit real agent' : 'Edit virtual agent'}
          gateway={gateway}
          realAgents={realAgents}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async ({ kind, ...vals }) => {
            if (kind === 'real') await api.patch(`/agents/real/${editing.id}`, vals);
            else                 await api.patch(`/agents/${editing.id}`, vals);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

const EMOJI_PRESETS = [
  '⚙️', '🤖', '🦾', '🛠', '🧠', '🔧', '📦', '📨', '📝', '🧪',
  '🛡', '🔍', '✨', '🚀', '🦉', '🦊', '🐝', '🐬', '🐉', '🪐',
];

const ROLE_PRESETS = [
  'Generalist', 'Researcher', 'Coder', 'Writer', 'Reviewer',
  'Triager', 'Support', 'Marketing', 'Data analyst', 'Lead',
];

function AgentModal({ title, gateway, realAgents, initial, onCancel, onSubmit }) {
  // Two flavors of "agent" with different create paths:
  //   • real    — gateway agent: { name, workspace, model, emoji, avatar }
  //               POST /agents/real → gateway's agents.create
  //   • virtual — DB persona that wraps a real agent with custom instructions
  //               POST /agents → DB
  // When editing, kind is fixed by the row; when creating, the user picks.
  const [kind, setKind] = useState(initial?.kind ?? 'real');

  // Boards (for virtual flow only)
  const orgsQ  = useApi(kind === 'virtual' ? '/orgs' : null, [kind]);
  const orgList = orgsQ.data?.items ?? [];
  const orgIdInitial = orgList[0]?.id;
  const [orgId, setOrgId] = useState(orgIdInitial);
  const groupsQ = useApi(orgId && kind === 'virtual' ? `/orgs/${orgId}/board-groups` : null, [orgId, kind]);
  const groups  = groupsQ.data?.items ?? [];
  const [allBoards, setAllBoards] = useState([]);
  const groupIdsKey = groups.map((g) => g.id).join(',');
  useEffect(() => {
    if (!groupIdsKey) { setAllBoards([]); return; }
    const ids = groupIdsKey.split(',');
    let alive = true;
    Promise.all(ids.map((id) => api.get(`/board-groups/${id}/boards`).catch(() => ({ items: [] }))))
      .then((results) => {
        if (!alive) return;
        setAllBoards(results.flatMap((r) => r.items ?? []));
      });
    return () => { alive = false; };
  }, [groupIdsKey]);
  useEffect(() => {
    if (!orgId && orgIdInitial) setOrgId(orgIdInitial);
  }, [orgIdInitial, orgId]);

  // Real-agent fields. Workspace is auto-derived server-side and not exposed
  // in the create form — we only keep it on edit (so the user can see/change
  // an existing agent's workspace).
  const [real, setReal] = useState({
    name:      initial?.kind === 'real' ? (initial.name      ?? '') : '',
    workspace: initial?.kind === 'real' ? (initial.workspace ?? '') : '',
    model:     initial?.kind === 'real' ? (initial.model     ?? '') : '',
    emoji:     initial?.kind === 'real' ? (initial.emoji     ?? '') : '',
    avatar:    initial?.kind === 'real' ? (initial.avatar    ?? '') : '',
  });

  // Virtual-agent fields
  const [virt, setVirt] = useState({
    name:                initial?.kind === 'virtual' ? (initial.name               ?? '') : '',
    role:                initial?.kind === 'virtual' ? (initial.role               ?? 'Generalist') : 'Generalist',
    boardId:             initial?.kind === 'virtual' ? (initial.boardId            ?? '') : '',
    emoji:               initial?.kind === 'virtual' ? (initial.emoji              ?? '⚙️') : '⚙️',
    baseAgentId:         initial?.kind === 'virtual' ? (initial.baseAgentId        ?? '') : (realAgents[0]?.id ?? ''),
    communicationStyle:  initial?.kind === 'virtual' ? (initial.communicationStyle ?? 'direct, concise, practical') : 'direct, concise, practical',
    heartbeatInterval:   initial?.kind === 'virtual' ? (initial.heartbeatInterval  ?? '10m') : '10m',
    instructions:        initial?.kind === 'virtual' ? (initial.instructions       ?? '') : '',
    isBoardLead:         initial?.kind === 'virtual' ? (initial.isBoardLead        ?? false) : false,
  });

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Real agent: only name is required from the user; workspace is auto-derived
  // server-side from the convention used by existing agents on the gateway.
  const valid = kind === 'real'
    ? real.name.trim()
    : virt.name.trim() && virt.baseAgentId.trim() && virt.boardId;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog dialog--lg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        {!initial && (
          <div className="agent-tabs">
            <button type="button"
              className={`agent-tab${kind === 'real' ? ' agent-tab--active' : ''}`}
              onClick={() => setKind('real')}>
              Real agent
              <span className="page-muted" style={{ marginLeft: 8, fontSize: 11.5 }}>
                gateway-backed
              </span>
            </button>
            <button type="button"
              className={`agent-tab${kind === 'virtual' ? ' agent-tab--active' : ''}`}
              onClick={() => setKind('virtual')}>
              Virtual persona
              <span className="page-muted" style={{ marginLeft: 8, fontSize: 11.5 }}>
                wraps a real agent
              </span>
            </button>
          </div>
        )}

        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try {
            if (kind === 'real') {
              const payload = { name: real.name.trim() };
              // workspace is only sent on edit (when user can see/change it);
              // for create we omit it and the backend derives the path.
              if (real.workspace.trim()) payload.workspace = real.workspace.trim();
              if (real.model.trim())     payload.model     = real.model.trim();
              if (real.emoji.trim())     payload.emoji     = real.emoji.trim();
              if (real.avatar.trim())    payload.avatar    = real.avatar.trim();
              await onSubmit({ kind: 'real', ...payload });
            } else {
              await onSubmit({ kind: 'virtual', ...virt, boardId: virt.boardId || null });
            }
          } catch (x) { setErr(x.message); }
          finally   { setBusy(false); }
        }}>

          {kind === 'real' ? (
            <RealAgentForm
              gateway={gateway}
              vals={real} setVals={setReal}
              showEmojiPicker={showEmojiPicker} setShowEmojiPicker={setShowEmojiPicker}
            />
          ) : (
            <VirtualAgentForm
              vals={virt} setVals={setVirt}
              realAgents={realAgents} allBoards={allBoards}
              showEmojiPicker={showEmojiPicker} setShowEmojiPicker={setShowEmojiPicker}
            />
          )}

          {err && <p className="page-toast page-toast--error" style={{ marginTop: 10 }}>{err}</p>}

          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button type="button" className="dialog-cancel" onClick={onCancel} disabled={busy}>
              Back to agents
            </button>
            <button type="submit" className="dialog-confirm"
              disabled={busy || !valid}>
              {busy ? 'Saving…' : (initial ? 'Save' : (kind === 'real' ? 'Create real agent' : 'Create virtual agent'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RealAgentForm({ gateway, vals, setVals, showEmojiPicker, setShowEmojiPicker }) {
  // Pull the gateway's model catalog so the user picks instead of typing.
  const modelsRes = useGatewayResource({
    gateway,
    method:     'models.list',
    intervalMs: 0,
  });
  const modelOptions = useMemo(() => {
    const raw = modelsRes.data?.models ?? modelsRes.data?.data ?? modelsRes.data?.items
             ?? (Array.isArray(modelsRes.data) ? modelsRes.data : []);
    return raw
      .map((m) => (typeof m === 'string' ? m : (m.id ?? m.name ?? m.model)))
      .filter(Boolean);
  }, [modelsRes.data]);

  return (
    <>
      <div className="agent-section">
        <div className="agent-section-title">GATEWAY AGENT</div>
        <div className="agent-grid">
          <div className="ov-field">
            <label className="ov-label">Agent name *</label>
            <input className="ov-input" autoFocus
              placeholder="e.g. news-bot"
              value={vals.name}
              onChange={(e) => setVals({ ...vals, name: e.target.value })} />
          </div>
          <div className="ov-field">
            <label className="ov-label">Default model</label>
            <select className="ov-input"
              value={vals.model}
              onChange={(e) => setVals({ ...vals, model: e.target.value })}
              disabled={modelsRes.loading}>
              <option value="">— Use gateway default —</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {modelsRes.error && (
              <span className="page-muted" style={{ fontSize: 11.5, color: '#f87171' }}>
                Couldn't load models: {modelsRes.error}
              </span>
            )}
          </div>
          <div className="ov-field">
            <label className="ov-label">Emoji</label>
            <div className="agent-emoji-row">
              <button type="button" className="agent-emoji-btn"
                onClick={() => setShowEmojiPicker((v) => !v)}>
                <span className="agent-emoji-glyph">{vals.emoji || '⚙️'}</span>
                <span className="page-muted">Pick emoji</span>
              </button>
              {showEmojiPicker && (
                <div className="agent-emoji-grid">
                  {EMOJI_PRESETS.map((e) => (
                    <button key={e} type="button" className="agent-emoji-cell"
                      onClick={() => { setVals({ ...vals, emoji: e }); setShowEmojiPicker(false); }}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="ov-field">
            <label className="ov-label">Avatar URL</label>
            <input className="ov-input"
              placeholder="https://… (optional)"
              value={vals.avatar}
              onChange={(e) => setVals({ ...vals, avatar: e.target.value })} />
          </div>
        </div>
        <div className="ov-field wide" style={{ marginTop: 12 }}>
          <span className="page-muted" style={{ fontSize: 11.5 }}>
            The workspace directory is auto-created next to your existing agents
            (e.g. <code className="page-mono">~/.openclaw/workspace-&lt;name&gt;</code>).
            Real agents are written to your gateway's openclaw.json and become
            available for chat, tasks, and as the base for virtual personas.
          </span>
        </div>
      </div>
    </>
  );
}

function VirtualAgentForm({ vals, setVals, realAgents, allBoards, showEmojiPicker, setShowEmojiPicker }) {
  return (
    <>
      <div className="agent-section">
        <div className="agent-section-title">BASIC CONFIGURATION</div>
        <div className="agent-grid">
          <div className="ov-field">
            <label className="ov-label">Agent name *</label>
            <input className="ov-input" autoFocus
              placeholder="e.g. Deploy bot"
              value={vals.name}
              onChange={(e) => setVals({ ...vals, name: e.target.value })} />
          </div>
          <div className="ov-field">
            <label className="ov-label">Role</label>
            <input className="ov-input" list="role-presets"
              value={vals.role}
              onChange={(e) => setVals({ ...vals, role: e.target.value })} />
            <datalist id="role-presets">
              {ROLE_PRESETS.map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
          <div className="ov-field">
            <label className="ov-label">Board *</label>
            <select className="ov-input"
              value={vals.boardId}
              onChange={(e) => setVals({ ...vals, boardId: e.target.value })}>
              <option value="">— Select board —</option>
              {allBoards.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="ov-field">
            <label className="ov-label">Emoji</label>
            <div className="agent-emoji-row">
              <button type="button" className="agent-emoji-btn"
                onClick={() => setShowEmojiPicker((v) => !v)}>
                <span className="agent-emoji-glyph">{vals.emoji}</span>
                <span className="page-muted">Pick emoji</span>
              </button>
              {showEmojiPicker && (
                <div className="agent-emoji-grid">
                  {EMOJI_PRESETS.map((e) => (
                    <button key={e} type="button" className="agent-emoji-cell"
                      onClick={() => { setVals({ ...vals, emoji: e }); setShowEmojiPicker(false); }}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="ov-field wide" style={{ marginTop: 12 }}>
          <label className="ov-label">Base OpenClaw agent *</label>
          {realAgents.length ? (
            <select className="ov-input" value={vals.baseAgentId}
              onChange={(e) => setVals({ ...vals, baseAgentId: e.target.value })}>
              <option value="">— Select agent —</option>
              {realAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name ?? a.id}</option>
              ))}
            </select>
          ) : (
            <input className="ov-input"
              placeholder="No real agents yet — create one in the Real agent tab first"
              value={vals.baseAgentId}
              onChange={(e) => setVals({ ...vals, baseAgentId: e.target.value })} />
          )}
          <span className="page-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            Tasks assigned to this persona will run through this base agent with your instructions applied.
          </span>
        </div>
      </div>

      <div className="agent-section">
        <div className="agent-section-title">PERSONALITY &amp; BEHAVIOR</div>
        <div className="ov-field wide">
          <label className="ov-label">Communication style</label>
          <input className="ov-input"
            placeholder="direct, concise, practical"
            value={vals.communicationStyle}
            onChange={(e) => setVals({ ...vals, communicationStyle: e.target.value })} />
        </div>
        <div className="ov-field wide" style={{ marginTop: 10 }}>
          <label className="ov-label">System instructions</label>
          <textarea className="ov-input" rows={4}
            placeholder="You are a senior copywriter. Keep replies under 200 words…"
            value={vals.instructions}
            onChange={(e) => setVals({ ...vals, instructions: e.target.value })} />
        </div>
        <div className="ov-field wide" style={{ marginTop: 10 }}>
          <label className="ov-label">
            <input type="checkbox" checked={vals.isBoardLead}
              onChange={(e) => setVals({ ...vals, isBoardLead: e.target.checked })}
              style={{ marginRight: 8 }} />
            This agent is the board lead (only the lead can mark tasks done if the board enforces it)
          </label>
        </div>
      </div>

      <div className="agent-section">
        <div className="agent-section-title">SCHEDULE &amp; NOTIFICATIONS</div>
        <div className="ov-field wide">
          <label className="ov-label">Interval</label>
          <input className="ov-input"
            placeholder="10m"
            value={vals.heartbeatInterval}
            onChange={(e) => setVals({ ...vals, heartbeatInterval: e.target.value })} />
          <span className="page-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            How often this agent runs HEARTBEAT.md (10m, 30m, 2h, 1d).
          </span>
        </div>
      </div>
    </>
  );
}
