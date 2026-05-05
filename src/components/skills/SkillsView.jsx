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

import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Search, Sparkles } from 'lucide-react';
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

  // Toggle — try several method/param shapes since the right one varies.
  const toggle = useCallback(async (skill) => {
    if (gateway.status !== 'on') return;
    if (busy.has(skill.id)) return;

    const next = !skill.active;
    setBusy((p) => new Set([...p, skill.id]));
    setToast('');

    const attempts = [
      { method: 'skills.update',  params: { id: skill.id, enabled: next } },
      { method: 'skills.update',  params: { id: skill.id, active:  next } },
      { method: 'skills.update',  params: { id: skill.id, disabled: !next } },
      { method: next ? 'skills.install' : 'skills.uninstall', params: { id: skill.id } },
    ];

    let lastErr = null;
    let success = false;
    for (const { method, params } of attempts) {
      try {
        await gateway.request(method, params);
        success = true;
        break;
      } catch (e) {
        lastErr = `${method}: ${e.message}`;
      }
    }

    setBusy((p) => { const s = new Set(p); s.delete(skill.id); return s; });

    if (success) {
      // Re-fetch to get the authoritative new state
      skills.refresh();
      tools.refresh();
    } else {
      setToast(`Couldn't toggle "${skill.name}". ${lastErr ?? ''}`);
    }
  }, [gateway, busy, skills, tools]);

  const loading = skills.loading || tools.loading;
  const error   = (skills.error && tools.error) ? `${skills.error}; ${tools.error}` : '';

  return (
    <div className="ov-view">
      <PageHeader
        title="Skills"
        subtitle={`Capabilities and tools wired into ${config?.agentId || 'this'} agent.`}
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={() => { skills.refresh(); tools.refresh(); }}
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
  return {
    id:          s.id ?? s.name ?? s.slug,
    name:        s.name ?? s.id ?? s.label ?? s.slug,
    description: s.description ?? s.summary ?? s.help,
    group:       s.group ?? s.category ?? s.profile ?? s.namespace,
    version:     s.version,
    source:      s.source ?? s.pluginId,
    active:      isActive({ ...s, __source: sourceTag }),
    raw:         s,
  };
}
