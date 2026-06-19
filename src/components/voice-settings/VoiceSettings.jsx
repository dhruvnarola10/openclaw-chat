// ElevenLabs voice configuration modal.
//
//   Step 1 — API key: enter + verify (loads voices & models via backend proxy)
//   Step 2 — Model + Voice pickers (shown after the key verifies)
//   Save → persists to localStorage (voiceSettings); useTalk/useVoice pick it
//   up on the next spoken reply, no reload.

import { useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Play, Search, X } from 'lucide-react';
import { useElevenLabs } from '../../hooks/useElevenLabs.js';
import './voice-settings.css';

export default function VoiceSettings({ onClose }) {
  const el = useElevenLabs();
  const selectedVoice = el.voices.find((v) => v.voice_id === el.voiceId);
  const selectedModel = el.models.find((m) => m.model_id === el.modelId);

  const save = () => {
    el.saveSettings();
    onClose?.();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="vs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vs-head">
          <h2>Voice settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="vs-sub">Natural voices for voice-to-voice chat, powered by ElevenLabs.</p>

        <ApiKeyInput
          apiKey={el.apiKey}
          onApiKeyChange={el.setApiKey}
          onVerify={() => el.fetchVoicesAndModels()}
          loading={el.loading}
          error={el.error}
          verified={el.verified}
          voiceCount={el.voices.length}
        />

        {el.verified && (
          <>
            <ModelPicker models={el.models} selectedModelId={el.modelId} onSelect={el.setModelId} />
            <VoicePicker
              voices={el.voices}
              selectedVoiceId={el.voiceId}
              onSelect={el.setVoiceId}
              onPreview={el.previewVoice}
            />
          </>
        )}

        <div className="vs-footer">
          <div className="vs-summary">
            {selectedVoice && <span>Voice: <strong>{selectedVoice.name}</strong></span>}
            {selectedModel && <span> · Model: <strong>{selectedModel.name}</strong></span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ov-btn" onClick={onClose}>Cancel</button>
            <button className="ov-btn ov-btn--primary" onClick={save} disabled={!el.verified || !el.voiceId}>
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── API key ─────────────────────────────────────────────────────────────

function ApiKeyInput({ apiKey, onApiKeyChange, onVerify, loading, error, verified, voiceCount }) {
  const [show, setShow] = useState(false);
  return (
    <div className="vs-section">
      <label className="ov-label">ElevenLabs API Key</label>
      <div className="vs-key-row">
        <div className="ov-input-wrap" style={{ flex: 1 }}>
          <input
            className="ov-input"
            type={show ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="sk_…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="ov-eye" onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button className="ov-btn ov-btn--primary" onClick={onVerify} disabled={loading || !apiKey}>
          {loading ? <Loader2 size={14} className="spin" /> : null} Verify & Load
        </button>
      </div>
      {verified && !error && (
        <div className="vs-ok"><Check size={13} /> {voiceCount} voices loaded</div>
      )}
      {error && <div className="ov-err" style={{ marginTop: 6 }}>{error}</div>}
      <a className="vs-link" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">
        Get your API key →
      </a>
    </div>
  );
}

// ── Model picker ──────────────────────────────────────────────────────────

function modelBadge(m) {
  if (/v3/i.test(m.model_id)) return 'Best quality';
  if (/flash|turbo/i.test(m.model_id)) return 'Real-time';
  if ((m.languages?.length ?? 0) > 10) return 'Multilingual';
  return null;
}

function ModelPicker({ models, selectedModelId, onSelect }) {
  if (!models.length) return null;
  return (
    <div className="vs-section">
      <label className="ov-label">TTS Model</label>
      <div className="vs-model-grid">
        {models.map((m) => {
          const badge = modelBadge(m);
          const active = m.model_id === selectedModelId;
          return (
            <button
              key={m.model_id}
              className={`vs-model-card${active ? ' is-active' : ''}`}
              onClick={() => onSelect(m.model_id)}
            >
              <div className="vs-model-name">
                {m.name}
                {badge && <span className="vs-badge">{badge}</span>}
              </div>
              {m.description && <div className="vs-model-desc">{m.description.slice(0, 80)}{m.description.length > 80 ? '…' : ''}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Voice picker ────────────────────────────────────────────────────────

const CATS = ['All', 'premade', 'cloned', 'generated', 'professional'];

function VoicePicker({ voices, selectedVoiceId, onSelect, onPreview }) {
  const [q, setQ]     = useState('');
  const [cat, setCat] = useState('All');

  const shown = voices.filter((v) => {
    if (cat !== 'All' && (v.category ?? 'premade') !== cat) return false;
    if (q.trim() && !v.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  const cats = ['All', ...Array.from(new Set(voices.map((v) => v.category).filter(Boolean)))];

  return (
    <div className="vs-section">
      <label className="ov-label">Voice</label>
      <div className="vs-voice-bar">
        <div className="ov-input-wrap" style={{ flex: 1 }}>
          <Search size={13} className="vs-search-icon" />
          <input className="ov-input" placeholder="Search voices…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 30 }} />
        </div>
      </div>
      <div className="vs-cat-tabs">
        {cats.map((c) => (
          <button key={c} className={`vs-cat${cat === c ? ' is-active' : ''}`} onClick={() => setCat(c)}>
            {c === 'All' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <div className="vs-voice-grid">
        {shown.map((v) => {
          const active = v.voice_id === selectedVoiceId;
          const labels = v.labels ? Object.values(v.labels).filter(Boolean).slice(0, 3) : [];
          return (
            <div key={v.voice_id} className={`vs-voice-card${active ? ' is-active' : ''}`} onClick={() => onSelect(v.voice_id)}>
              <div className="vs-voice-top">
                <span className="vs-voice-name">{active && <Check size={12} />}{v.name}</span>
                <button
                  className="vs-preview"
                  onClick={(e) => { e.stopPropagation(); onPreview(v); }}
                  title="Preview"
                >
                  <Play size={12} />
                </button>
              </div>
              {v.category && <span className="vs-badge">{v.category}</span>}
              {labels.length > 0 && <div className="vs-voice-labels">{labels.join(' · ')}</div>}
            </div>
          );
        })}
      </div>
      {!shown.length && <div className="page-muted" style={{ padding: 12 }}>No voices match.</div>}
    </div>
  );
}
