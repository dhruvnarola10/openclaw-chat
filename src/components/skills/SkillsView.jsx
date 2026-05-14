// Skills page — capability catalog with active/total counts, per-skill
// details, and toggle controls.
//
// Data sources tried in order:
//   1. skills.status — primary; usually scoped by agentId
//   2. tools.catalog — fallback when skills.status isn't exposed
//
// Toggle: clicking the switch tries `skills.update` (with several param
// variants — different OpenClaw versions accept different shapes) and
// optimistically reflects the new state. If every variant fails, the
// switch reverts and an error toast appears.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

// Heuristic: is this skill currently enabled? Tries multiple shapes that
// different versions of OpenClaw return.
function isActive(s) {
  if (typeof s.enabled  === 'boolean') return s.enabled;
  if (typeof s.disabled === 'boolean') return !s.disabled;
  if (typeof s.active   === 'boolean') return s.active;
  if (typeof s.installed === 'boolean') return s.installed;
  if (typeof s.state === 'string') {
    return /(active|enabled|on|installed)/i.test(s.state);
  }
  if (typeof s.status === 'string') {
    return /(active|enabled|on|installed|ok)/i.test(s.status);
  }
  // Default: a skill listed in `skills.status` without an explicit
  // disabled flag is considered active. tools.catalog entries are all
  // available capabilities — we show them, but don't claim active.
  return s.__source === 'skills.status';
}

export default function SkillsView({ gateway, config }) {
  const [query,  setQuery]  = useState('');
  const [busy,   setBusy]   = useState(new Set());     // ids being toggled
  const [toast,  setToast]  = useState('');             // last error

  const skills = useGatewayResource({
    gateway,
    method: 'skills.status',
    params: config?.agentId ? { agentId: config.agentId } : {},
    intervalMs: 60_000,
  });

  const tools = useGatewayResource({
    gateway,
    method:     'tools.catalog',
    intervalMs: 60_000,
    enabled:    !!skills.error,
  });

  const { items, source } = useMemo(() => {
    if (skills.data) {
      const raw = skills.data.skills ?? skills.data.entries ?? skills.data.items
               ?? (Array.isArray(skills.data) ? skills.data : []);
      return {
        items:  raw.map((s) => normalize(s, 'skills.status')),
        source: 'skills.status',
      };
    }
    if (tools.data) {
      const raw = tools.data.entries ?? tools.data.items
               ?? (Array.isArray(tools.data) ? tools.data : []);
      return {
        items:  raw.map((s) => normalize(s, 'tools.catalog')),
        source: 'tools.catalog',
      };
    }
    return { items: [], source: null };
  }, [skills.data, tools.data]);

  const totals = useMemo(() => {
    const total  = items.length;
    const active = items.filter((s) => s.active).length;
    return { total, active };
  }, [items]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.group || '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const s of filtered) {
      const k = s.group || 'Uncategorized';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Toggle a skill on/off. The gateway's `skills.update` schema accepts
  // exactly one shape for this:  { skillKey, enabled }
  // (other anyOf branch is for clawhub installs and needs `source`).
  const toggle = useCallback(async (skill) => {
    if (gateway.status !== 'on') return;
    if (busy.has(skill.id)) return;

    const skillKey = skill.skillKey ?? skill.id;
    if (!skillKey) {
      setToast(`Couldn't toggle "${skill.name}": no skillKey on this entry.`);
      return;
    }

    const next = !skill.active;
    setBusy((p) => new Set([...p, skill.id]));
    setToast('');

    try {
      await gateway.request('skills.update', { skillKey, enabled: next });
      skills.refresh();
      tools.refresh();
    } catch (e) {
      setToast(`Couldn't toggle "${skill.name}": ${e.message}`);
    } finally {
      setBusy((p) => { const s = new Set(p); s.delete(skill.id); return s; });
    }
  }, [gateway, busy, skills, tools]);

  const loading = skills.loading || tools.loading;
  const error   = (skills.error && tools.error) ? `${skills.error}; ${tools.error}` : '';

  // ── Install-skill marketplace modal ──────────────────────────────────
  const [installerOpen, setInstallerOpen] = useState(false);
  const refreshAll = () => { skills.refresh(); tools.refresh(); };

  return (
    <div className="ov-view">
      <PageHeader
        title="Skills"
        subtitle={`Capabilities and tools wired into ${config?.agentId || 'this'} agent.`}
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={refreshAll}
        right={
          <button className="ov-btn ov-btn--primary"
            disabled={gateway.status !== 'on'}
            onClick={() => setInstallerOpen(true)}
            title={gateway.status === 'on' ? 'Install a new skill from ClawHub or a Git URL' : 'Connect first'}>
            <Plus size={14} /> Install skill
          </button>
        }
      />

      <div className="ov-stat-row">
        <div className="ov-tile">
          <div className="ov-tile-title">TOTAL SKILLS</div>
          <div className="ov-tile-value">{totals.total}</div>
        </div>
        <div className="ov-tile ov-tile--good">
          <div className="ov-tile-title">ACTIVE</div>
          <div className="ov-tile-value">{totals.active}</div>
          <div className="ov-tile-hint">
            {totals.total ? Math.round((totals.active / totals.total) * 100) : 0}% enabled
          </div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">CATEGORIES</div>
          <div className="ov-tile-value">{grouped.length}</div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">SOURCE</div>
          <div className="ov-tile-value" style={{ fontSize: 14, fontFamily: 'monospace' }}>
            {source || '—'}
          </div>
          <div className="ov-tile-hint">RPC method providing data</div>
        </div>
      </div>

      {toast && (
        <div className="page-toast page-toast--error">
          {toast}
          <button className="page-toast-close" onClick={() => setToast('')}>×</button>
        </div>
      )}

      <section className="ov-card">
        <div className="page-toolbar">
          <div className="page-search">
            <Search size={14} />
            <input
              className="ov-input"
              placeholder="Filter skills…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="page-count">
            {filtered.length} shown · {totals.active} of {totals.total} active
          </span>
        </div>

        {!filtered.length
          ? <EmptyState
              icon={Sparkles}
              title={gateway.status !== 'on' ? 'Gateway offline' : 'No skills'}
              message={gateway.status !== 'on'
                ? 'Connect from Overview.'
                : (query ? 'No matches.' : 'Install skills via the OpenClaw catalog.')}
              error={error}
              onRetry={() => { skills.refresh(); tools.refresh(); }}
            />
          : grouped.map(([group, list]) => (
              <div key={group} className="skill-group">
                <h3 className="skill-group-title">
                  {group}
                  <span className="skill-group-count">{list.length}</span>
                </h3>
                <div className="skill-grid">
                  {list.map((s) => (
                    <SkillCard
                      key={s.id || s.name}
                      skill={s}
                      busy={busy.has(s.id)}
                      onToggle={() => toggle(s)}
                      togglable={source === 'skills.status'}
                    />
                  ))}
                </div>
              </div>
            ))}
      </section>

      {installerOpen && (
        <InstallSkillModal
          gateway={gateway}
          onClose={() => setInstallerOpen(false)}
          onInstalled={() => { setInstallerOpen(false); refreshAll(); }}
        />
      )}
    </div>
  );
}

// ── Install-skill marketplace modal ──────────────────────────────────────
//
// Two tabs:
//   • ClawHub  — calls `skills.search`, lists results, install via
//                `skills.install { source: 'clawhub', slug }`
//   • From URL — direct git install via
//                `skills.install { name, installId }` where installId is the
//                git URL or whatever identifier the gateway recognises.
function InstallSkillModal({ gateway, onClose, onInstalled }) {
  const [tab, setTab] = useState('marketplace');   // 'marketplace' | 'direct'
  // Marketplace state
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [installingSlug, setInstallingSlug] = useState(null);
  // Direct-install state
  const [directName, setDirectName] = useState('');
  const [directId,   setDirectId]   = useState('');
  const [directBusy, setDirectBusy] = useState(false);
  const [error,      setError]      = useState('');

  // ClawHub's skills.search returns an empty list when called with no query
  // (it's a relevance-scored search, not a list-all endpoint). So we only
  // run a search after the user has typed at least one character. Debounced
  // 250ms to avoid hammering the registry on every keystroke.
  const runSearch = useCallback(async (q) => {
    if (!q || !q.trim()) {
      setResults([]);
      setSearchErr('');
      setSearching(false);
      return;
    }
    setSearching(true); setSearchErr('');
    try {
      const payload = await gateway.request('skills.search', { query: q.trim(), limit: 50 });
      setResults(payload?.results ?? []);
    } catch (e) {
      setSearchErr(e.message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [gateway]);

  useEffect(() => {
    if (tab !== 'marketplace') return;
    const t = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, tab, runSearch]);

  const installFromClawHub = async (slug) => {
    if (installingSlug) return;
    setInstallingSlug(slug); setError('');
    try {
      await gateway.request('skills.install', { source: 'clawhub', slug });
      onInstalled();
    } catch (e) {
      setError(`Install failed: ${e.message}`);
    } finally {
      setInstallingSlug(null);
    }
  };

  const installDirect = async () => {
    if (!directName.trim() || !directId.trim() || directBusy) return;
    setDirectBusy(true); setError('');
    try {
      await gateway.request('skills.install', {
        name:      directName.trim(),
        installId: directId.trim(),
      });
      onInstalled();
    } catch (e) {
      setError(`Install failed: ${e.message}`);
    } finally {
      setDirectBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Install skill</h3>
          <button className="row-action" onClick={onClose} title="Close"><X size={14} /></button>
        </div>

        <div className="agent-tabs" style={{ marginBottom: 14 }}>
          <button type="button"
            className={`agent-tab${tab === 'marketplace' ? ' agent-tab--active' : ''}`}
            onClick={() => setTab('marketplace')}>
            ClawHub marketplace
          </button>
          <button type="button"
            className={`agent-tab${tab === 'direct' ? ' agent-tab--active' : ''}`}
            onClick={() => setTab('direct')}>
            From Git URL
          </button>
        </div>

        {error && (
          <div className="page-toast page-toast--error" style={{ marginBottom: 12 }}>{error}</div>
        )}

        {tab === 'marketplace' ? (
          <>
            <div className="page-search" style={{ marginBottom: 12 }}>
              <Search size={14} />
              <input className="ov-input"
                placeholder="Search ClawHub (e.g. brave, github, calendar)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus />
            </div>

            {searching && !results.length && (
              <p className="page-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={14} className="spin" /> Searching…
              </p>
            )}
            {searchErr && (
              <p className="page-toast page-toast--error">{searchErr}</p>
            )}
            {!searching && !searchErr && !results.length && !query.trim() && (
              // Empty-state when the user hasn't typed anything yet. ClawHub's
              // search is relevance-scored, not a list-all — so we prompt the
              // user instead of showing "0 results".
              <div style={{ padding: '8px 4px' }}>
                <p className="page-muted" style={{ marginBottom: 10 }}>
                  Start typing to search ClawHub. Try one of these:
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['github', 'brave', 'calendar', 'gmail', 'slack', 'notion', 'gemini', 'web-search']
                    .map((s) => (
                      <button key={s} type="button" className="ov-btn"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => setQuery(s)}>
                        {s}
                      </button>
                    ))}
                </div>
              </div>
            )}
            {!searching && !searchErr && !results.length && query.trim() && (
              <p className="page-muted">No skills match "{query.trim()}".</p>
            )}

            {!!results.length && (
              <ul className="ws-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
                {results.map((r) => (
                  <li key={r.slug} className="ws-list-row" style={{ alignItems: 'center' }}>
                    <div className="ws-list-main">
                      <span className="page-strong">{r.displayName}</span>
                      {r.summary && <span className="page-muted">{r.summary}</span>}
                      <span className="page-muted" style={{ fontSize: 11.5 }}>
                        <code className="page-mono">{r.slug}</code>
                        {r.version && <> · v{r.version}</>}
                      </span>
                    </div>
                    <button className="ov-btn ov-btn--primary"
                      onClick={() => installFromClawHub(r.slug)}
                      disabled={!!installingSlug}>
                      {installingSlug === r.slug
                        ? <><Loader2 size={13} className="spin" /> Installing…</>
                        : <><Download size={13} /> Install</>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="page-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
              Install a skill directly from a Git repo or any installId the gateway
              recognises. Use this when the skill isn't published to ClawHub.
            </p>
            <div className="ov-field wide">
              <label className="ov-label">Display name *</label>
              <input className="ov-input"
                placeholder="e.g. acme-internal-tools"
                value={directName}
                onChange={(e) => setDirectName(e.target.value)} />
            </div>
            <div className="ov-field wide" style={{ marginTop: 10 }}>
              <label className="ov-label">Install ID (Git URL or local path) *</label>
              <input className="ov-input"
                placeholder="e.g. https://github.com/acme/openclaw-skill"
                value={directId}
                onChange={(e) => setDirectId(e.target.value)} />
              <span className="page-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                The gateway clones / fetches this URL into its skills directory and
                rebuilds. Make sure the repo follows the OpenClaw skill manifest format.
              </span>
            </div>
            <div className="dialog-actions" style={{ marginTop: 16 }}>
              <button className="dialog-cancel" onClick={onClose} disabled={directBusy}>
                Cancel
              </button>
              <button className="dialog-confirm" onClick={installDirect}
                disabled={!directName.trim() || !directId.trim() || directBusy}>
                {directBusy ? 'Installing…' : 'Install'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill: s, busy, onToggle, togglable }) {
  return (
    <div className={`skill-card${s.active ? '' : ' skill-card--off'}`}>
      <div className="skill-card-head">
        <span className="skill-card-name">{s.name || s.id || '—'}</span>
        {togglable
          ? <Switch checked={!!s.active} disabled={busy} onChange={onToggle} />
          : (s.active && <CheckCircle2 size={14} className="skill-card-check" />)
        }
      </div>
      {s.description && <p className="skill-card-desc">{s.description}</p>}
      <div className="skill-card-meta">
        {s.version && <span className="page-pill">v{s.version}</span>}
        {s.source  && <code className="page-mono">{s.source}</code>}
      </div>
    </div>
  );
}

function Switch({ checked, disabled, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`oc-switch${checked ? ' oc-switch--on' : ''}${disabled ? ' oc-switch--busy' : ''}`}
      onClick={onChange}
      disabled={disabled}
      title={checked ? 'Disable' : 'Enable'}
    >
      <span className="oc-switch-knob" />
    </button>
  );
}

function normalize(s, sourceTag) {
  // skillKey is the canonical key the gateway uses in `skills.update`
  // (entries[skillKey]). It comes back from `skills.status` directly;
  // tools.catalog uses `key`/`id`/`slug` so fall back to those.
  const skillKey = s.skillKey ?? s.key ?? s.id ?? s.slug ?? s.name;
  return {
    id:          skillKey,
    skillKey,
    name:        s.name ?? s.id ?? s.label ?? s.slug,
    description: s.description ?? s.summary ?? s.help,
    group:       s.group ?? s.category ?? s.profile ?? s.namespace,
    version:     s.version,
    source:      s.source ?? s.pluginId,
    active:      isActive({ ...s, __source: sourceTag }),
    raw:         s,
  };
}
