// Right-side configuration drawer.

import { RefreshCw, Trash2, X } from 'lucide-react';
import Select from '../common/Select.jsx';

export default function SettingsPanel({
  config, models, status, onClose, onClearHistory,
}) {
  const { apiUrl, token, agentId, model, stream } = config;
  const { list, loading, error, onRefresh } = models;

  return (
    <aside className="settings">
      <div className="settings-head">
        <h2>Configuration</h2>
        <button className="icon-btn" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="settings-body">
        <Field label="API URL">
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => config.setApiUrl(e.target.value)}
            placeholder="/api/responses"
          />
        </Field>

        <Field label="Bearer Token">
          <textarea
            value={token}
            onChange={(e) => config.setToken(e.target.value)}
            rows={3}
            placeholder="Enter bearer token"
          />
        </Field>

        <Field label="Agent ID">
          <input
            type="text"
            value={agentId}
            onChange={(e) => config.setAgentId(e.target.value)}
            placeholder="main"
          />
        </Field>

        <div className="field">
          <div className="field-label-row">
            <label>Model</label>
            <button
              className={`refresh-btn${loading ? ' spinning' : ''}`}
              onClick={onRefresh}
              disabled={loading}
              title="Refresh model list"
            >
              <RefreshCw size={11} />
            </button>
          </div>

          {list.length > 0 ? (
            <Select
              value={model}
              options={list.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => config.setModel(v)}
              placeholder="Select a model"
            />
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => config.setModel(e.target.value)}
              placeholder="leonardo"
              className={loading ? 'loading' : ''}
            />
          )}

          {error && (
            <div className="field-err-block">
              <span className="field-err">{error}</span>
              <span className="field-err-hint">Check API URL and bearer token, then click ↺</span>
            </div>
          )}
          {loading && !error && <span className="field-hint">Fetching models…</span>}
          {!loading && !error && list.length === 0 && (
            <span className="field-hint">No models found — click ↺ to retry</span>
          )}
        </div>

        <div className="field field-row">
          <label>Streaming</label>
          <button
            className={`toggle-btn${stream ? ' on' : ''}`}
            onClick={() => config.setStream((s) => !s)}
          >
            {stream ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div className="env-note">
          Defaults loaded from <code>.env</code>. Settings are saved to localStorage and override .env on reload.
        </div>

        <div className="status-card">
          <div className="status-card-title">Status</div>
          <div className="status-row">
            <span className={`status-dot ${stream ? 'on' : 'off'}`} />&nbsp;
            Streaming {stream ? 'enabled' : 'disabled'}
          </div>
          <div className="status-row">
            <span className="status-label">Model</span>
            <span className="status-val">{model}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Threads</span>
            <span className="status-val">{status.threadCount}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Messages</span>
            <span className="status-val">{status.messageCount}</span>
          </div>
        </div>

        <button className="clear-btn" onClick={onClearHistory}>
          <Trash2 size={14} />Clear All History
        </button>
      </div>
    </aside>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
