// Renders a single chat message. Three visual variants:
//   – User text         → "user-bubble"  on the right with avatar
//   – User /command     → "cmd-sent-pill" left-aligned monospace pill
//   – Assistant text    → "asst" with optional thinking block
//   – System command    → "system-bubble" with terminal icon + "system" tag
//   – Error             → red-tinted assistant bubble

import { useCallback, useState } from 'react';
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
        {!msg.streaming && !msg.isError && (msg.model || msg.usage) && (
          <MessageMeta usage={msg.usage} model={msg.model} stopReason={msg.stopReason} />
        )}
      </div>
    </div>
  );
}

// Meta row mirroring OpenClaw's built-in dashboard. Collapsed by default —
// click the "Context" pill to reveal tokens + model.
//   collapsed:  > Context
//   expanded:   v Context  ↑3.5k  ↓349  R20.3k  18% ctx  gpt-oss:120b-cloud
function MessageMeta({ usage, model, stopReason }) {
  const [open, setOpen] = useState(false);
  const u = normalizeUsage(usage);
  const items = [];

  if (u.input  != null) items.push({ key: 'in',  label: '↑', value: compact(u.input) });
  if (u.output != null) items.push({ key: 'out', label: '↓', value: compact(u.output) });
  if (u.cacheRead != null && u.cacheRead > 0) {
    items.push({ key: 'cache', label: 'R', value: compact(u.cacheRead) });
  }
  if (u.contextPct != null) {
    items.push({ key: 'ctx', label: '', value: `${u.contextPct}% ctx` });
  }

  if (!items.length && !model && !stopReason) return null;

  return (
    <div className="msg-meta">
      <button
        type="button"
        className={`msg-meta-toggle${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>Context</span>
      </button>

      {open && (
        <>
          {items.map((it) => (
            <span key={it.key} className="msg-meta-tok">
              {it.label && <span className="msg-meta-arrow">{it.label}</span>}
              <span>{it.value}</span>
            </span>
          ))}
          {model && <code className="msg-meta-model">{model}</code>}
          {stopReason && stopReason !== 'stop' && stopReason !== 'end_turn' && (
            <span className="msg-meta-stop">stop: {stopReason}</span>
          )}
        </>
      )}
    </div>
  );
}

// Pull token counts out of the various shapes the gateway/HTTP API ship.
// `↑` shows cumulative input tokens (matches the built-in dashboard's
// running context-window count); `↓` shows the current turn's output tokens.
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return {};
  const input  = pick(u, [
    'cumulativeTokens',          // sessions.usage.timeseries running total
    'inputTokens', 'input_tokens', 'input',
    'promptTokens', 'prompt_tokens',
  ]);
  const output = pick(u, ['outputTokens','output_tokens', 'output', 'completionTokens', 'completion_tokens']);
  const cacheRead  = pick(u, ['cacheRead',  'cache_read',  'cacheReadTokens']);
  const cacheWrite = pick(u, ['cacheWrite', 'cache_write', 'cacheWriteTokens']);
  const totalTokens = pick(u, ['totalTokens', 'total_tokens', 'total']);
  const contextPct  = pick(u, ['contextPct', 'context_percent', 'ctxPct', 'utilization']);
  return { input, output, cacheRead, cacheWrite, totalTokens, contextPct };
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null) return Number(obj[k]);
  }
  return null;
}

// 3500 → "3.5k", 349 → "349", 20300 → "20.3k", 1200000 → "1.2M"
function compact(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
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
