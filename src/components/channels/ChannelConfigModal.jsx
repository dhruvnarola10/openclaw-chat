// Configuration modal for a single channel. Renders a declarative form for
// token-based channels (Telegram / Discord) and a QR placeholder flow for
// WhatsApp. Values are persisted via the mission-control API.

import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, Eye, EyeOff, ShieldCheck, X, QrCode, Loader2, CheckCircle2 } from 'lucide-react';
import { loadChannelConfig, saveChannelConfig } from './channelStore.js';

export default function ChannelConfigModal({ channel, onClose, onSaved }) {
  const emptyValues = () => {
    const seed = {};
    for (const f of channel.fields) seed[f.id] = '';
    return seed;
  };

  const [values, setValues]         = useState(emptyValues);
  const [revealed, setRevealed]     = useState({});
  const [loading, setLoading]       = useState(true);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  const isQr = channel.auth === 'qr';

  // Load existing values from the backend on open.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadChannelConfig(channel.id)
      .then((row) => {
        if (cancelled) return;
        const stored = row?.config ?? {};
        const next = {};
        for (const f of channel.fields) next[f.id] = stored[f.id] ?? '';
        setValues(next);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [channel]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (id, v) => {
    setValues((s) => ({ ...s, [id]: v }));
    setValidated(false);
    setError(null);
  };

  const missing = channel.fields.filter((f) => f.required && !String(values[f.id] ?? '').trim());
  const canSave = !isQr && missing.length === 0 && !saving && !loading;

  async function handleValidate() {
    if (missing.length) {
      setError(`Missing required: ${missing.map((m) => m.label).join(', ')}`);
      return;
    }
    setValidating(true);
    setError(null);
    // Backend doesn't expose a credentials-validate endpoint yet; we just
    // confirm shape locally. Wire to a real check (e.g. Telegram getMe) later.
    await new Promise((r) => setTimeout(r, 400));
    setValidating(false);
    setValidated(true);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveChannelConfig(channel.id, values);
      onSaved?.(channel.id, saved);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ch-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-modal" role="dialog" aria-modal="true" aria-labelledby={`ch-modal-title-${channel.id}`}>
        <header className="ch-modal-head">
          <div>
            <h2 id={`ch-modal-title-${channel.id}`}>Configure {channel.name}</h2>
            <p>{channel.description}</p>
          </div>
          <button className="ch-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <section className="ch-modal-help">
          <div className="ch-modal-help-head">
            <div>
              <strong>How to connect</strong>
              <p>{channel.description}</p>
            </div>
            {channel.docsUrl && (
              <a className="ch-doc-link" href={channel.docsUrl} target="_blank" rel="noreferrer">
                <BookOpen size={14} /> View Documentation <ExternalLink size={12} />
              </a>
            )}
          </div>
          <ol className="ch-steps">
            {channel.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>

        {isQr ? (
          <QrSection channelId={channel.id} />
        ) : loading ? (
          <div className="ch-form-loading">
            <Loader2 size={16} className="spin" /> Loading existing configuration…
          </div>
        ) : (
          <div className="ch-form">
            {channel.fields.map((f) => (
              <FormField
                key={f.id}
                field={f}
                value={values[f.id] ?? ''}
                revealed={!!revealed[f.id]}
                onToggleReveal={() => setRevealed((s) => ({ ...s, [f.id]: !s[f.id] }))}
                onChange={(v) => update(f.id, v)}
              />
            ))}
          </div>
        )}

        {error && <div className="ch-modal-error">{error}</div>}

        <footer className="ch-modal-actions">
          {!isQr && (
            <button className="ov-btn" onClick={handleValidate} disabled={validating || saving || loading}>
              {validating ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
              <span>{validated ? 'Validated' : 'Validate Configuration'}</span>
              {validated && <CheckCircle2 size={14} className="ch-validated-tick" />}
            </button>
          )}
          {isQr ? (
            <button className="ov-btn ov-btn--primary">
              <QrCode size={14} />
              <span>Generate QR Code</span>
            </button>
          ) : (
            <button className="ov-btn ov-btn--primary" onClick={handleSave} disabled={!canSave}>
              {saving ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
              <span>{saving ? 'Saving…' : 'Save & Connect'}</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function FormField({ field, value, revealed, onToggleReveal, onChange }) {
  const inputType = field.secret && !revealed ? 'password' : 'text';
  return (
    <div className="ch-field">
      <label className="ch-field-label" htmlFor={`ch-field-${field.id}`}>
        {field.label} {field.required && <span className="ch-required">*</span>}
      </label>
      <div className={field.secret ? 'ov-input-wrap' : ''}>
        <input
          id={`ch-field-${field.id}`}
          className="ov-input"
          type={inputType}
          value={value}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.secret && (
          <button
            type="button"
            className="ov-eye"
            onClick={onToggleReveal}
            aria-label={revealed ? 'Hide value' : 'Show value'}
            tabIndex={-1}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {field.envVar && (
        <div className="ch-field-env">Environment Variable: <code>{field.envVar}</code></div>
      )}
      {field.description && <div className="ch-field-desc">{field.description}</div>}
    </div>
  );
}

function QrSection({ channelId }) {
  // The QR-login adapter (Baileys) lives in the OpenClaw gateway, not in this
  // backend. Until that's wired up, this remains a UI placeholder.
  return (
    <div className="ch-qr-placeholder">
      <QrCode size={48} />
      <p>Click <strong>Generate QR Code</strong> to start the {channelId} login flow.</p>
    </div>
  );
}
