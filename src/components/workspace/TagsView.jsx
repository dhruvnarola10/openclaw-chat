// Tags catalog. Tags are organization-scoped — you must pick an org first.

import { useEffect, useState } from 'react';
import { Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { api, useApi } from '../../hooks/useApi.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

const PRESET_COLORS = ['#7c3aed','#ef4444','#f59e0b','#22c55e','#3b82f6','#ec4899','#8b5cf6','#14b8a6','#6b7280'];

export default function TagsView() {
  const orgs = useApi('/orgs');
  const orgList = orgs.data?.items ?? [];
  const [orgId, setOrgId] = useState('');

  // Auto-select first org
  useEffect(() => {
    if (!orgId && orgList.length) setOrgId(orgList[0].id);
  }, [orgList, orgId]);

  const tags = useApi(orgId ? `/orgs/${orgId}/tags` : null, [orgId]);
  const items = tags.data?.items ?? [];
  const [showCreate, setShowCreate] = useState(false);

  const remove = async (id) => {
    if (!confirm('Delete this tag? It will be removed from all tasks too.')) return;
    await api.delete(`/tags/${id}`); tags.refresh();
  };

  return (
    <div className="ov-view">
      <PageHeader
        title="Tags"
        subtitle="Organization-scoped labels you can attach to tasks."
        refreshing={tags.loading}
        onRefresh={tags.refresh}
        right={<>
          {orgList.length > 1 && (
            <select className="ov-input" value={orgId} onChange={(e) => setOrgId(e.target.value)} style={{ width: 200 }}>
              {orgList.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)} disabled={!orgId}>
            <Plus size={14} /> New tag
          </button>
        </>}
      />

      <section className="ov-card">
        {!orgList.length && <EmptyState icon={TagIcon} title="No organizations" message="Create an organization in Workspace first." />}
        {orgList.length > 0 && tags.loading && !items.length && <EmptyState title="Loading…" />}
        {tags.error && <EmptyState title="Failed to load" error={tags.error} onRetry={tags.refresh} />}
        {!tags.loading && !tags.error && orgList.length > 0 && !items.length && (
          <EmptyState icon={TagIcon} title="No tags" message="Create your first tag to start labeling tasks." />
        )}
        {!!items.length && (
          <ul className="tags-grid">
            {items.map((t) => (
              <li key={t.id} className="tag-chip-row">
                <span
                  className="tag-chip-color"
                  style={{ background: t.color ?? '#7c3aed' }}
                  title={t.color}
                />
                <div className="tag-chip-meta">
                  <span className="page-strong">{t.name}</span>
                  {t.color && <code className="page-mono tag-chip-hex">{t.color}</code>}
                </div>
                <button className="row-action row-action--danger" onClick={() => remove(t.id)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCreate && (
        <CreateTagModal
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => {
            await api.post(`/orgs/${orgId}/tags`, vals);
            setShowCreate(false); tags.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateTagModal({ onSubmit, onCancel }) {
  const [name,  setName]  = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 340 }}>
        <h3>New tag</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try { await onSubmit({ name: name.trim(), color }); }
          catch (x) { setErr(x.message); }
          finally   { setBusy(false); }
        }}>
          <div className="ov-form" style={{ marginTop: 14 }}>
            <div className="ov-field wide">
              <label className="ov-label">Name</label>
              <input className="ov-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="ov-field wide">
              <label className="ov-label">Color</label>
              <div className="tag-color-grid">
                {PRESET_COLORS.map((c) => (
                  <button key={c} type="button"
                    className={`tag-color-swatch${c === color ? ' is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
          {err && <p className="page-toast page-toast--error" style={{ marginTop: 10 }}>{err}</p>}
          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button type="button" className="dialog-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="dialog-confirm" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
