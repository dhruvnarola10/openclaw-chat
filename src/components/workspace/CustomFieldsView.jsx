// Custom field definitions (per-org). Mirrors mission-control's
// /custom-fields page. Field types: text|text_long|integer|decimal|boolean
// |date|date_time|url|json. Visibility: always|if_set|hidden.

import { useEffect, useState } from 'react';
import { Plus, Tags as TagsIcon, Trash2 } from 'lucide-react';
import { api, useApi } from '../../hooks/useApi.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

const FIELD_TYPES = [
  { value: 'text',       label: 'Text (short)' },
  { value: 'text_long',  label: 'Text (long / multiline)' },
  { value: 'integer',    label: 'Integer' },
  { value: 'decimal',    label: 'Decimal' },
  { value: 'boolean',    label: 'Yes / No' },
  { value: 'date',       label: 'Date' },
  { value: 'date_time',  label: 'Date + time' },
  { value: 'url',        label: 'URL' },
  { value: 'json',       label: 'JSON' },
];

const VISIBILITY = [
  { value: 'always', label: 'Always show' },
  { value: 'if_set', label: 'Show if set' },
  { value: 'hidden', label: 'Hidden' },
];

export default function CustomFieldsView() {
  const orgs = useApi('/orgs');
  const orgList = orgs.data?.items ?? [];
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    if (!orgId && orgList.length) setOrgId(orgList[0].id);
  }, [orgList, orgId]);

  const fields = useApi(orgId ? `/orgs/${orgId}/custom-fields` : null, [orgId]);
  const items = fields.data?.items ?? [];
  const [showCreate, setShowCreate] = useState(false);

  const remove = async (id) => {
    if (!confirm('Delete this custom field definition?')) return;
    await api.delete(`/custom-fields/${id}`); fields.refresh();
  };

  return (
    <div className="ov-view">
      <PageHeader
        title="Custom fields"
        subtitle="Reusable metadata fields you can attach to any task in this organization."
        refreshing={fields.loading}
        onRefresh={fields.refresh}
        right={<>
          {orgList.length > 1 && (
            <select className="ov-input" value={orgId} onChange={(e) => setOrgId(e.target.value)} style={{ width: 200 }}>
              {orgList.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button className="ov-btn ov-btn--primary" onClick={() => setShowCreate(true)} disabled={!orgId}>
            <Plus size={14} /> New field
          </button>
        </>}
      />

      <section className="ov-card">
        {!orgList.length && <EmptyState icon={TagsIcon} title="No organizations" />}
        {orgList.length > 0 && fields.loading && !items.length && <EmptyState title="Loading…" />}
        {fields.error && <EmptyState title="Failed to load" error={fields.error} onRetry={fields.refresh} />}
        {!fields.loading && !fields.error && orgList.length > 0 && !items.length && (
          <EmptyState icon={TagsIcon} title="No custom fields" />
        )}
        {!!items.length && (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Visibility</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div className="page-stack">
                        <span className="page-strong">{f.label}</span>
                        {f.description && <span className="page-muted">{f.description}</span>}
                      </div>
                    </td>
                    <td><code className="page-mono">{f.fieldKey}</code></td>
                    <td>{FIELD_TYPES.find((t) => t.value === f.fieldType)?.label ?? f.fieldType}</td>
                    <td>
                      <span className={`status-chip status-chip--${f.required ? 'on' : 'paused'}`}>
                        {f.required ? 'required' : 'optional'}
                      </span>
                    </td>
                    <td>{VISIBILITY.find((v) => v.value === f.uiVisibility)?.label ?? f.uiVisibility}</td>
                    <td>
                      <button className="row-action row-action--danger" onClick={() => remove(f.id)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && (
        <CreateFieldModal
          onCancel={() => setShowCreate(false)}
          onSubmit={async (vals) => {
            await api.post(`/orgs/${orgId}/custom-fields`, vals);
            setShowCreate(false); fields.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateFieldModal({ onSubmit, onCancel }) {
  const [vals, setVals] = useState({
    fieldKey: '', label: '', fieldType: 'text', uiVisibility: 'always',
    required: false, description: '',
  });
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 420 }}>
        <h3>New custom field</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try { await onSubmit(vals); }
          catch (x) { setErr(x.message); }
          finally   { setBusy(false); }
        }}>
          <div className="ov-form" style={{ marginTop: 14 }}>
            <div className="ov-field wide">
              <label className="ov-label">Label *</label>
              <input className="ov-input" value={vals.label}
                onChange={(e) => setVals({ ...vals, label: e.target.value })} autoFocus />
            </div>
            <div className="ov-field wide">
              <label className="ov-label">Field key * (lowercase, _ allowed)</label>
              <input className="ov-input" placeholder="e.g. customer_id"
                value={vals.fieldKey}
                onChange={(e) => setVals({ ...vals, fieldKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
            </div>
            <div className="ov-field">
              <label className="ov-label">Type</label>
              <select className="ov-input" value={vals.fieldType}
                onChange={(e) => setVals({ ...vals, fieldType: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="ov-field">
              <label className="ov-label">Visibility</label>
              <select className="ov-input" value={vals.uiVisibility}
                onChange={(e) => setVals({ ...vals, uiVisibility: e.target.value })}>
                {VISIBILITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div className="ov-field wide">
              <label className="ov-label">
                <input type="checkbox" checked={vals.required}
                  onChange={(e) => setVals({ ...vals, required: e.target.checked })}
                  style={{ marginRight: 8 }} />
                Required when creating a task
              </label>
            </div>
            <div className="ov-field wide">
              <label className="ov-label">Description (helper text)</label>
              <textarea className="ov-input" rows={2}
                value={vals.description}
                onChange={(e) => setVals({ ...vals, description: e.target.value })} />
            </div>
          </div>
          {err && <p className="page-toast page-toast--error" style={{ marginTop: 10 }}>{err}</p>}
          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button type="button" className="dialog-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="dialog-confirm" disabled={busy || !vals.label || !vals.fieldKey}>
              {busy ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
