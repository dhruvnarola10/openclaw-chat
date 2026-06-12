// Auto-growing textarea + send/stop button + slash-command popup
// + multi-modal attachments (click, drag-drop, clipboard paste).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Pause, Radio, Send, Volume2 } from 'lucide-react';
import SlashPopup       from './SlashPopup.jsx';
import AttachmentList   from './AttachmentList.jsx';
import { useAttachments } from '../../hooks/useAttachments.js';
import { SUPPORTED_ACCEPT } from '../../utils/files.js';

export default function MessageInput({
  value, onChange, onSend, onStop,
  loading, slash,
  onOpenVoice, voiceActive,
  talk,
}) {
  const ref     = useRef(null);
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const att = useAttachments();

  // Auto-grow textarea up to 200 px.
  const grow = useCallback(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);
  useEffect(grow, [value, grow]);

  // Submit logic shared by Send button + Enter key.
  const submit = useCallback(() => {
    const text = value.trim();
    if (!text && att.items.length === 0) return;
    onSend({ text, attachments: att.toMessageShape() });
    onChange('');
    att.clear();
  }, [value, att, onSend, onChange]);

  const handleChange = (e) => {
    onChange(e.target.value);
    slash.onInputChange();
  };

  const applySlash = useCallback((item) => {
    onChange(item.cmd + ' ');
    slash.onInputChange();
    ref.current?.focus();
  }, [onChange, slash]);

  const handleKey = (e) => {
    if (slash.handleKey(e, applySlash)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // ── Attachment entry points ────────────────────────────────────────

  const onFilesPicked = (e) => {
    if (e.target.files?.length) att.add(e.target.files);
    e.target.value = '';   // reset so picking the same file again still fires
  };

  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      att.add(files);
    }
  };

  const onDragEnter = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) att.add(e.dataTransfer.files);
  };

  return (
    <div className="input-area">
      <div
        className={`input-wrap${dragOver ? ' drag-over' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="drag-overlay">
            <Paperclip size={22} /> Drop files to attach
          </div>
        )}

        {slash.open && (
          <SlashPopup
            results={slash.results}
            idx={slash.idx}
            onSelect={applySlash}
            onHover={slash.setIdx}
          />
        )}

        <AttachmentList
          items={att.items}
          error={att.error}
          onRemove={att.remove}
          onClear={att.clear}
        />

        {(talk?.talkActive || talk?.error) && <TalkTranscript talk={talk} />}

        <div className="input-box">
          <button
            className="attach-btn"
            onClick={() => fileRef.current?.click()}
            title="Attach files"
            disabled={loading}
          >
            <Paperclip size={16} />
            {att.items.length > 0 && (
              <span className="attach-count">{att.items.length}</span>
            )}
          </button>

          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={SUPPORTED_ACCEPT}
            onChange={onFilesPicked}
          />

          <textarea
            ref={ref}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKey}
            onPaste={onPaste}
            placeholder="Message Leonardo… (type / for commands · drop or paste files)"
            className="chat-input"
            rows={1}
            disabled={loading}
          />

          <div className="input-right">
            {talk?.supported && (
              <button
                className={`talk-btn${talk.talkActive ? ' talk-btn--active' : ''}`}
                onClick={talk.toggle}
                title={talk.talkActive ? 'Stop talk' : 'Start Talk'}
                disabled={loading && !talk.talkActive}
              >
                {talk.talkActive ? <Volume2 size={16} /> : <Radio size={16} />}
              </button>
            )}
            {/* {onOpenVoice && (
              <button
                className={`voice-btn${voiceActive ? ' voice-btn--active' : ''}`}
                onClick={onOpenVoice}
                title="Voice mode"
                disabled={loading}
              >
                <Mic size={16} />
              </button>
            )} */}
            {loading
              ? <button className="stop-btn" onClick={onStop} title="Pause" aria-label="Pause generation"><Pause size={16} /></button>
              : (
                <button
                  className="send-btn"
                  onClick={submit}
                  disabled={!value.trim() && att.items.length === 0}
                  title="Send"
                >
                  <Send size={16} />
                </button>
              )
            }
          </div>
        </div>
      </div>
      <div className="input-hint">
        Enter to send · Shift+Enter for new line · Drop / paste to attach
        {/* {onOpenVoice && <> · <span className="hint-voice" onClick={onOpenVoice}>🎙 Voice</span></>} */}
      </div>
    </div>
  );
}

// Live transcript bar shown above the input while Talk Mode is active.
// Mirrors the OpenClaw built-in dashboard's "You: …" / "Leonardo: …" lines.
function TalkTranscript({ talk }) {
  const { state, userInterim, assistantSpeaking, error, toggle } = talk;

  let label = '';
  let body  = '';
  if (error) {
    label = 'Talk error';
    body  = error;
  } else if (state === 'connecting') {
    body = 'Connecting…';
  } else if (state === 'speaking' && assistantSpeaking) {
    label = 'Leonardo';
    body  = assistantSpeaking;
  } else if (state === 'listening' && userInterim) {
    label = 'You';
    body  = userInterim;
  } else if (state === 'thinking') {
    body = 'Thinking…';
  } else if (state === 'listening') {
    body = 'Listening…';
  } else {
    body = '';
  }

  return (
    <div className={`talk-transcript talk-transcript--${state}${error ? ' talk-transcript--error' : ''}`}>
      <span className="talk-transcript-dot" aria-hidden="true" />
      {label && <strong>{label}:</strong>}
      <span className="talk-transcript-body">{body}</span>
      {error && (
        <button className="talk-transcript-close" onClick={toggle} title="Dismiss">×</button>
      )}
    </div>
  );
}
