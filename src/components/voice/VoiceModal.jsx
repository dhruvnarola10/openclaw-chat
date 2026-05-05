// Full-screen voice overlay — Gemini-style voice interface.
// Tap the orb to speak; orb animates to mic level while listening;
// assistant response is read aloud automatically.

import { useEffect } from 'react';
import { X, MicOff } from 'lucide-react';
import VoiceOrb from './VoiceOrb.jsx';

const STATE_LABEL = {
  idle:       'Tap to speak',
  loading:    'Loading voice model (~40 MB)…',
  listening:  'Listening…',
  processing: 'Thinking…',
  speaking:   'Speaking…',
};

export default function VoiceModal({
  voiceState, interim, level, error, supported,
  onOrbClick, onStopSpeaking, onClose,
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOrbClick = () => {
    if (voiceState === 'loading' || voiceState === 'processing') return;
    if (voiceState === 'speaking')   { onStopSpeaking(); return; }
    if (voiceState === 'idle')       { onOrbClick();     return; }
    if (voiceState === 'listening')  { onOrbClick();     return; }
  };

  return (
    <div className="voice-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="voice-modal">

        {/* Header */}
        <div className="voice-header">
          <span className="voice-title">Voice Mode</span>
          <button className="voice-close-btn" onClick={onClose} title="Close voice mode">
            <X size={18} />
          </button>
        </div>

        {/* Main orb area */}
        <div className="voice-center">
          {supported ? (
            <VoiceOrb
              state={voiceState}
              level={level}
              onClick={handleOrbClick}
            />
          ) : (
            <div className="voice-unsupported">
              <MicOff size={40} />
              <p>Voice not supported</p>
            </div>
          )}

          {/* Status label */}
          <div className="voice-status-label">
            {STATE_LABEL[voiceState] ?? 'Tap to speak'}
          </div>

          {/* Live transcript */}
          {interim && (
            <div className="voice-transcript">
              <span className="voice-transcript-text">{interim}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="voice-error">{error}</div>
          )}
        </div>

        {/* Footer hints */}
        <div className="voice-footer">
          {voiceState === 'loading'
            ? 'First-time setup. Cached for next time.'
            : voiceState === 'speaking'
            ? 'Tap orb to interrupt'
            : voiceState === 'listening'
            ? 'Tap orb to cancel · speak now'
            : voiceState === 'processing'
            ? 'Waiting for response…'
            : 'Tap the orb to start speaking'
          }
        </div>

      </div>
    </div>
  );
}
