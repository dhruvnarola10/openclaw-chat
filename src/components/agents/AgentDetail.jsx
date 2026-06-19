// Per-agent settings — mirrors OpenClaw's built-in Control UI Agents page.
//
// Tabs:
//   Overview — workspace, runtime, primary model (editable), identity
//   Files    — core workspace files (AGENTS/SOUL/TOOLS/IDENTITY/USER/
//              HEARTBEAT/MEMORY): read + edit + save  (agents.files.*)
//   Tools    — effective tool inventory for this agent, grouped (read-only)
//   Skills   — visible skill inventory for this agent (read-only)
//   Channels — gateway-wide channel snapshot (read-only)
//   Cron     — scheduled jobs targeting this agent (read-only)
//
// All data comes straight from the gateway over the existing WS client
// (operator scope), matching how SkillsView/CronView/ChannelsView work.
// Tools/Skills/Channels/Cron are read-only here: their writes live in
// openclaw.json and we don't want to risk corrupting it blind. Overview
// (model) and Files are fully editable via confirmed agents.* RPCs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, Loader2, RefreshCw, Save, Wrench, Zap,
  Plug, Clock, Eye, EyeOff,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { mdComponents, mdRemarkPlugins } from '../chat/markdown.jsx';
import { ago } from '../../utils/format.js';
import EmptyState from '../common/EmptyState.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'files',    label: 'Files' },
  { id: 'tools',    label: 'Tools' },
  { id: 'skills',   label: 'Skills' },
  { id: 'channels', label: 'Channels' },
  { id: 'cron',     label: 'Cron Jobs' },
];

export default function AgentDetail({ agent, gateway, onBack, onSetActive, activeAgentId }) {
  const [tab, setTab] = useState('overview');
  const agentId = agent.id;

  return (
    <div className="ov-view">
      <div className="agent-detail-head">
        <button className="ov-btn" onClick={onBack}><ArrowLeft size={14} /> Agents</button>
        <div className="agent-detail-title">
          <h1 className="ov-h1">{agent.name || agent.id}</h1>
          <code className="page-mono">{agentId}</code>
        </div>
        {agent.kind !== 'virtual' && agentId !== activeAgentId && (
          <button className="ov-btn" onClick={() => onSetActive?.(agentId)} title="Use for new chats">
            Set active
          </button>
        )}
        {agentId === activeAgentId && (
          <span className="status-chip status-chip--on"><Check size={12} /> active</span>
        )}
      </div>

      <div className="agent-detail-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`agent-detail-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab agent={agent} gateway={gateway} />}
      {tab === 'files'    && <FilesTab    agentId={agentId} gateway={gateway} />}
      {tab === 'tools'    && <ToolsTab    agentId={agentId} gateway={gateway} />}
      {tab === 'skills'   && <SkillsTab   agentId={agentId} gateway={gateway} />}
      {tab === 'channels' && <ChannelsTab gateway={gateway} />}
      {tab === 'cron'     && <CronTab     agentId={agentId} gateway={gateway} />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ agent, gateway }) {
  const [model, setModel]   = useState(agent.model || '');
  const [saving, setSaving] = useState(false);
  const [toast,  setToast]  = useState('');
  const modelsRes = useGatewayResource({ gateway, method: 'models.list', intervalMs: 0 });
  const modelList = useMemo(() => {
    const raw = modelsRes.data?.models ?? modelsRes.data?.data ?? (Array.isArray(modelsRes.data) ? modelsRes.data : []);
    return raw.map((m) => (typeof m === 'string' ? { id: m, label: m } : { id: m.id ?? m.name, label: m.label ?? m.name ?? m.id }))
      .filter((m) => m.id);
  }, [modelsRes.data]);

  useEffect(() => { setModel(agent.model || ''); }, [agent.model]);

  const save = async () => {
    setSaving(true); setToast('');
    try {
      await gateway.request('agents.update', { agentId: agent.id, model });
      setToast('Saved ✓');
      setTimeout(() => setToast(''), 2500);
    } catch (e) { setToast(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="ov-card">
      <div className="ov-card-head"><h2>Overview</h2><p>Workspace paths and identity metadata.</p></div>

      <div className="agent-meta-grid">
        <Meta label="Workspace"><code className="page-mono">{agent.workspace || '—'}</code></Meta>
        <Meta label="Runtime"><code className="page-mono">{agent.runtime || 'auto'}</code></Meta>
        <Meta label="Identity">{agent.emoji} {agent.name || agent.id}</Meta>
        <Meta label="Kind">{agent.kind || 'real'}</Meta>
      </div>

      {agent.kind !== 'virtual' && (
        <div className="agent-overview-form">
          <label className="ov-label">Primary model</label>
          {modelList.length ? (
            <select className="ov-input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">(agent default)</option>
              {modelList.map((m) => {
                const id = m.id ?? m;
                return <option key={id} value={id}>{m.label ?? id}</option>;
              })}
            </select>
          ) : (
            <input className="ov-input" value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="provider/model" />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button className="ov-btn ov-btn--primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save
            </button>
            {toast && <span className={toast.includes('✓') ? 'page-muted' : 'ov-err'}>{toast}</span>}
          </div>
          <p className="page-muted" style={{ marginTop: 10, fontSize: 12 }}>
            Fallbacks and tool/skill policy are stored in openclaw.json — view them in the
            Tools and Skills tabs.
          </p>
        </div>
      )}
    </section>
  );
}

function Meta({ label, children }) {
  return (
    <div className="agent-meta">
      <div className="agent-meta-label">{label}</div>
      <div className="agent-meta-value">{children}</div>
    </div>
  );
}

// ── Files ───────────────────────────────────────────────────────────────

const CORE_FILES = ['AGENTS', 'SOUL', 'TOOLS', 'IDENTITY', 'USER', 'HEARTBEAT', 'MEMORY'];

function FilesTab({ agentId, gateway }) {
  const [name, setName]       = useState('IDENTITY');
  const [content, setContent] = useState('');
  const [loaded, setLoaded]   = useState('');     // last-loaded content (dirty check)
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [preview, setPreview] = useState(false);
  const [revealed, setRevealed] = useState(false);   // content blurred until Preview/reveal
  const [toast, setToast]     = useState('');
  const [workspace, setWorkspace] = useState('');

  const fileName = `${name}.md`;
  const dirty = content !== loaded;

  const load = useCallback(async (n) => {
    setLoading(true); setToast(''); setPreview(false); setRevealed(false);
    try {
      const r = await gateway.request('agents.files.get', { agentId, name: `${n}.md` });
      const c = r?.file?.content ?? '';
      setContent(c); setLoaded(c);
      if (r?.workspace) setWorkspace(r.workspace);
    } catch (e) {
      // File may not exist yet — start blank so the user can create it.
      setContent(''); setLoaded('');
      if (/not.?found|missing/i.test(e.message)) setToast('(file does not exist yet — saving creates it)');
      else setToast(e.message);
    } finally { setLoading(false); }
  }, [agentId, gateway]);

  useEffect(() => { load(name); }, [name, load]);

  const save = async () => {
    setSaving(true); setToast('');
    try {
      await gateway.request('agents.files.set', { agentId, name: fileName, content });
      setLoaded(content);
      setToast('Saved ✓');
      setTimeout(() => setToast(''), 2500);
    } catch (e) { setToast(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="ov-card">
      <div className="ov-card-head"><h2>Core Files</h2><p>Bootstrap persona, identity, and tool guidance.</p></div>
      {workspace && <div className="page-muted" style={{ marginBottom: 10 }}>Workspace: <code className="page-mono">{workspace}</code></div>}

      <div className="agent-file-tabs">
        {CORE_FILES.map((f) => (
          <button key={f} className={`agent-file-tab${name === f ? ' is-active' : ''}`} onClick={() => setName(f)}>
            {f}
          </button>
        ))}
      </div>

      <div className="agent-file-bar">
        <code className="page-mono">{workspace ? `${workspace}/${fileName}` : fileName}</code>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="ov-btn" onClick={() => { setRevealed(true); setPreview((p) => !p); }}>
            {preview ? <EyeOff size={13} /> : <Eye size={13} />} {preview ? 'Edit' : 'Preview'}
          </button>
          <button className="ov-btn" onClick={() => load(name)} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Reset
          </button>
          <button className="ov-btn ov-btn--primary" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>

      {toast && <div className={`page-muted${toast.includes('✓') ? '' : ' ov-err'}`} style={{ margin: '8px 0' }}>{toast}</div>}

      {loading ? (
        <div style={{ padding: 24 }}><EmptyState title="Loading…" /></div>
      ) : (
        <div className="agent-file-content">
          {preview ? (
            <div className={`agent-file-preview${revealed ? '' : ' is-blurred'}`}>
              <ReactMarkdown remarkPlugins={mdRemarkPlugins} components={mdComponents}>{content || '*(empty)*'}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              className={`agent-file-editor${revealed ? '' : ' is-blurred'}`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              readOnly={!revealed}
              placeholder={`# ${fileName}\n\nThis file is empty. Type to create it.`}
            />
          )}
          {!revealed && (
            <button className="agent-file-reveal" onClick={() => setRevealed(true)}>
              <Eye size={16} /> Click to reveal {fileName}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ── Tools (read-only) ─────────────────────────────────────────────────────

function ToolsTab({ agentId, gateway }) {
  // tools.effective resolves the inventory for a session; use a synthetic
  // settings-preview key scoped to this agent.
  const sessionKey = `agent:${agentId}:web:agent-settings`;
  const { data, loading, error, refresh } = useGatewayResource({
    gateway, method: 'tools.effective', params: { agentId, sessionKey }, intervalMs: 0,
  });
  const groups = data?.groups ?? [];
  const totalTools   = groups.reduce((n, g) => n + (g.tools?.length ?? 0), 0);
  const enabledTools = groups.reduce((n, g) => n + (g.tools?.filter((t) => t.enabled !== false).length ?? 0), 0);

  return (
    <section className="ov-card">
      <div className="ov-card-head ov-card-head--row">
        <div><h2>Tool Access</h2><p>Effective tools available to this agent ({enabledTools}/{totalTools} enabled). Read-only — edit in openclaw.json.</p></div>
        <button className="ov-btn" onClick={refresh}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>
      {loading && !data && <EmptyState title="Loading…" />}
      {error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
      {!loading && !error && !groups.length && <EmptyState icon={Wrench} title="No tools" message="This agent has no effective tools." />}
      {groups.map((g) => (
        <div key={g.name ?? g.label} className="agent-tool-group">
          <div className="agent-tool-group-head">
            <span>{g.label ?? g.name}</span>
            <span className="page-muted">{g.tools?.filter((t) => t.enabled !== false).length ?? 0}/{g.tools?.length ?? 0}</span>
          </div>
          <div className="agent-tool-list">
            {(g.tools ?? []).map((t) => (
              <code key={t.name ?? t.id}
                className={`agent-tool-chip${t.enabled === false ? ' is-off' : ''}`}>
                {t.name ?? t.id}
              </code>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// ── Skills (read-only) ────────────────────────────────────────────────────

function SkillsTab({ agentId, gateway }) {
  const { data, loading, error, refresh } = useGatewayResource({
    gateway, method: 'skills.status', params: { agentId }, intervalMs: 0,
  });
  const skills = data?.skills ?? data?.items ?? [];
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => `${s.skillKey ?? s.name ?? ''} ${s.description ?? ''}`.toLowerCase().includes(q));
  }, [skills, filter]);

  return (
    <section className="ov-card">
      <div className="ov-card-head ov-card-head--row">
        <div><h2>Skills</h2><p>Visible skill inventory for this agent ({skills.length}). Read-only — edit allowlist in openclaw.json.</p></div>
        <button className="ov-btn" onClick={refresh}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>
      {skills.length > 0 && (
        <input className="ov-input" placeholder="Search skills…" value={filter}
          onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
      )}
      {loading && !data && <EmptyState title="Loading…" />}
      {error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
      {!loading && !error && !skills.length && <EmptyState icon={Zap} title="No skills" />}
      <div className="agent-skill-list">
        {shown.map((s) => {
          const key = s.skillKey ?? s.name ?? s.id;
          const on  = s.enabled !== false && s.eligible !== false;
          return (
            <div key={key} className="agent-skill-row">
              <div className="agent-skill-main">
                <span className="page-strong">{key}</span>
                {s.description && <span className="page-muted">{s.description}</span>}
              </div>
              <span className={`status-chip status-chip--${on ? 'on' : 'paused'}`}>{on ? 'enabled' : 'disabled'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Channels (read-only snapshot) ──────────────────────────────────────────

function ChannelsTab({ gateway }) {
  const { data, loading, error, refresh } = useGatewayResource({
    gateway, method: 'channels.status', intervalMs: 0,
  });
  const items = Array.isArray(data?.items) ? data.items
    : Array.isArray(data?.channels) ? data.channels
    : (Array.isArray(data) ? data : []);

  return (
    <section className="ov-card">
      <div className="ov-card-head ov-card-head--row">
        <div><h2>Channels</h2><p>Gateway-wide channel status snapshot.</p></div>
        <button className="ov-btn" onClick={refresh}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>
      {loading && !data && <EmptyState title="Loading…" />}
      {error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
      {!loading && !error && !items.length && <EmptyState icon={Plug} title="No channels found" />}
      <div className="agent-skill-list">
        {items.map((c) => (
          <div key={c.id ?? c.channel ?? c.accountId} className="agent-skill-row">
            <div className="agent-skill-main">
              <span className="page-strong">{c.channel ?? c.id}</span>
              {c.accountId && <code className="page-mono">{c.accountId}</code>}
            </div>
            <span className={`status-chip status-chip--${c.ok || c.connected ? 'on' : 'paused'}`}>
              {c.ok || c.connected ? 'connected' : (c.status ?? 'idle')}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Cron (read-only, filtered to this agent) ───────────────────────────────

function CronTab({ agentId, gateway }) {
  const { data, loading, error, refresh } = useGatewayResource({
    gateway, method: 'cron.list', intervalMs: 0,
  });
  const allJobs = data?.jobs ?? data?.crons ?? data?.items ?? (Array.isArray(data) ? data : []);
  const jobs = allJobs.filter((j) => {
    const target = j.agentId ?? j.agent ?? j.target?.agentId;
    return !target || target === agentId;
  });

  return (
    <section className="ov-card">
      <div className="ov-card-head ov-card-head--row">
        <div><h2>Cron Jobs</h2><p>Scheduled jobs targeting this agent.</p></div>
        <button className="ov-btn" onClick={refresh}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>
      {loading && !data && <EmptyState title="Loading…" />}
      {error && <EmptyState title="Failed to load" error={error} onRetry={refresh} />}
      {!loading && !error && !jobs.length && <EmptyState icon={Clock} title="No cron jobs" message="No scheduled jobs target this agent." />}
      <div className="agent-skill-list">
        {jobs.map((j) => {
          const enabled = j.enabled !== false;
          return (
            <div key={j.id ?? j.name} className="agent-skill-row">
              <div className="agent-skill-main">
                <span className="page-strong">{j.name ?? j.id}</span>
                {j.schedule && <code className="page-mono">{j.schedule}</code>}
                {j.lastRunAt && <span className="page-muted">last {ago(new Date(j.lastRunAt).getTime())}</span>}
              </div>
              <span className={`status-chip status-chip--${enabled ? 'on' : 'paused'}`}>{enabled ? 'enabled' : 'disabled'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
