// Renders a single chat message. Three visual variants:
//   – User text         → "user-bubble"  on the right with avatar
//   – User /command     → "cmd-sent-pill" left-aligned monospace pill
//   – Assistant text    → "asst" with optional thinking block
//   – System command    → "system-bubble" with terminal icon + "system" tag
//   – Error             → red-tinted assistant bubble

import { useCallback } from 'react';
import { Bot, Brain, ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { mdComponents } from './markdown.jsx';
import MessageAttachments from './MessageAttachments.jsx';

// Some models emit XML-ish control tags inline with the user-facing content.
// Two distinct cases that need different treatment:
//
//   • <think>, <reasoning>, <analysis>, <scratchpad> — internal model
//     monologue. STRIP the tag AND its content.
//
//   • <final>, <answer>, <response>, <output> — the actual user-facing
//     answer (gpt-oss / harmony format wraps the response in <final>).
//     UNWRAP these — keep the inner text, drop the tags.
//
// Without this, react-markdown silently eats unknown HTML tags up to the
// next `>` and the message mysteriously goes blank or starts with "<final".
const REASONING_TAGS = ['think', 'reasoning', 'analysis', 'scratchpad'];
const ANSWER_TAGS    = ['final', 'answer', 'response', 'output'];

function cleanContent(text) {
  if (!text) return text;
  let s = text;

  // 1. Strip matched reasoning blocks (with their content).
  for (const tag of REASONING_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    s = s.replace(re, '');
  }

  // 2. Mid-stream: a reasoning tag opened but not yet closed — hide
  //    everything from the open tag to the end of the buffer.
  for (const tag of REASONING_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i');
    s = s.replace(re, '');
    // Also handle the case where the open tag itself isn't fully written:
    // "<thi" -> strip from the "<" onward.
    const partial = new RegExp(`<${tag.slice(0, 3)}[a-z]*$`, 'i');
    s = s.replace(partial, '');
  }

  // 3. Unwrap answer tags — keep the inner text.
  for (const tag of ANSWER_TAGS) {
    const matched = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
    s = s.replace(matched, '$1');
  }

  // 4. Strip orphan answer-tag opens/closes (mid-stream or unbalanced).
  for (const tag of [...ANSWER_TAGS, ...REASONING_TAGS]) {
    const orphan = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    s = s.replace(orphan, '');
  }

  return s;
}

export default function Message({ msg, expanded, setExpanded }) {
  const id = msg.id;
  const toggle = useCallback(
    () => setExpanded((p) => ({ ...p, [id]: !p[id] })),
    [id, setExpanded],
  );
  const isExpanded = expanded[id] === true;

  // ── User bubble ─────────────────────────────────────────────────────
  if (msg.role === 'user') {
    if (msg.isCommand) {
      return (
        <div className="msg-row cmd-sent-row">
          <span className="cmd-sent-pill">{msg.content}</span>
        </div>
      );
    }
    return (
      <div className="msg-row user">
        <div className="user-stack">
          <MessageAttachments attachments={msg.attachments} />
          {msg.content && <div className="user-bubble">{msg.content}</div>}
        </div>
        <div className="avatar avatar-user">You</div>
      </div>
    );
  }

  // ── System / command response ───────────────────────────────────────
  if (msg.isCommand) {
    const cleaned = cleanContent(msg.content);
    return (
      <div className="msg-row system-row">
        <div className="system-icon-wrap"><Terminal size={13} /></div>
        <div className="system-bubble">
          {msg.waiting && !msg.content && <ThinkingDots compact />}
          {cleaned && (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {cleaned}
              </ReactMarkdown>
              {msg.streaming && <span className="cursor" />}
            </>
          )}
          {!msg.streaming && cleaned && (
            <div className="system-footer">system</div>
          )}
        </div>
      </div>
    );
  }

  // ── Regular assistant ───────────────────────────────────────────────
  const cleaned = cleanContent(msg.content);
  return (
    <div className="msg-row assistant">
      <div className="avatar avatar-bot"><Bot size={16} /></div>
      <div className="asst">
        {(msg.thinking || msg.thinkingStreaming) && (
          <ThinkingBlock
            content={msg.thinking || ''}
            streaming={msg.thinkingStreaming}
            expanded={isExpanded}
            onToggle={toggle}
          />
        )}
        {msg.waiting && !cleaned && <ThinkingDots />}
        {cleaned && (
          <div className={`asst-msg${msg.isError ? ' error-msg' : ''}`}>
            {msg.isError
              ? <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{cleaned}</pre>
              : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {cleaned}
                </ReactMarkdown>
              )
            }
            {msg.streaming && <span className="cursor" />}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline pieces ─────────────────────────────────────────────────────

function ThinkingBlock({ content, streaming, expanded, onToggle }) {
  return (
    <div className="thinking">
      <button className="thinking-head" onClick={onToggle}>
        <Brain size={13} />
        <span>{streaming ? 'Thinking…' : 'Thought process'}</span>
        <span className="thinking-spacer" />
        {streaming && <span className="thinking-spinner" />}
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {expanded && (
        <div className="thinking-body">
          <p>{content}{streaming && <span className="cursor" />}</p>
        </div>
      )}
    </div>
  );
}

function ThinkingDots({ compact }) {
  return (
    <div className="thinking-dots" style={compact ? { padding: '6px 0' } : undefined}>
      <span className="dot" /><span className="dot" /><span className="dot" />
    </div>
  );
}
