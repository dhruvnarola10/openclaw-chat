// Listen for unsolicited new agent turns on the active thread's session.
//
// OpenClaw runs heavy tools (image_generate, music_generate, video_generate,
// long-running skills) asynchronously: the agent says "on it" and finishes
// its current turn; some seconds-to-minutes later the provider finishes
// and OpenClaw *wakes the agent* on the same sessionKey. The agent then
// emits a brand-new turn — same sessionKey, NEW runId — carrying the
// finished media path / final answer.
//
// useChat's handler locks onto the first runId it sees and unsubscribes
// on `state:"final"` — so without this hook the async wake is silently
// dropped and the user never sees the image.
//
// This hook subscribes persistently to the active thread's sessionKey
// and treats any event whose runId we haven't seen *and* that arrives
// while no send is in flight as a fresh assistant message. It mirrors the
// same delta / tool-call / MEDIA-token plumbing useChat uses.

import { useEffect, useRef } from 'react';
import { attachmentsFromMessageToolArgs, extractAttachmentsFromContent, extractMediaTokens } from '../utils/files.js';

// Same shape useChat uses internally — keep parity so cards look identical.
function toToolText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).filter(Boolean).join('\n');
  }
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text;
    if (typeof v.content === 'string') return v.content;
    if (Array.isArray(v.content)) {
      return v.content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).filter(Boolean).join('\n');
    }
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
  return String(v);
}

function mergeAttachments(existing, incoming) {
  if (!incoming?.length) return existing;
  const byId = new Map();
  for (const a of existing ?? []) byId.set(a.id, a);
  for (const a of incoming)      byId.set(a.id, a);
  return Array.from(byId.values());
}

// If we go silent on a runId for this long without seeing state:'final',
// finalise the message anyway. Prevents the bubble from sitting in
// "Thinking…" forever when the gateway never emits a closing event.
const SILENCE_FINALISE_MS = 15_000;

export function useAsyncReplies({ gateway, sessionKey, threadId, threadOps, isSendingRef }) {
  // runId → { msgId, watchdog } — tracks which runIds this listener owns.
  const runMapRef = useRef(new Map());

  // Reset the map when the active thread / sessionKey changes — otherwise
  // a stale runId from a previous thread could leak.
  useEffect(() => {
    for (const entry of runMapRef.current.values()) clearTimeout(entry.watchdog);
    runMapRef.current = new Map();
  }, [sessionKey, threadId]);

  useEffect(() => {
    if (!gateway?.subscribeToChat || !sessionKey || !threadId) return;

    const handler = (payload) => {
      const runId = payload.runId;
      if (!runId) return;

      const entry = runMapRef.current.get(runId);

      // If we haven't claimed this runId yet and a send is currently in
      // flight, useChat is handling it — stay out of the way.
      if (!entry && isSendingRef?.current) return;

      // Claim or look up the assistant message we're streaming into.
      let msgId = entry?.msgId;
      if (!msgId) {
        msgId = threadOps.appendAssistantMessage(threadId, { waiting: true, streaming: true });
        runMapRef.current.set(runId, { msgId, watchdog: null });
      }

      // Reset the silence watchdog on every event we receive for this run.
      const slot = runMapRef.current.get(runId);
      if (slot) {
        clearTimeout(slot.watchdog);
        slot.watchdog = setTimeout(() => {
          threadOps.patchMessage(threadId, msgId, (m) => ({
            ...m,
            waiting: false,
            streaming: false,
            thinkingStreaming: false,
          }));
          { const s = runMapRef.current.get(runId); if (s) clearTimeout(s.watchdog); runMapRef.current.delete(runId); }
        }, SILENCE_FINALISE_MS);
      }

      // Tool-stream events (protocol v4) — mirror useChat.
      if (payload.stream === 'tool') {
        const d  = payload.data ?? {};
        const id = d.toolCallId || `${d.name}:tool`;
        const args = d.args ?? {};
        const isMessageTool =
          d.name === 'message' || d.name === 'message.send' ||
          (args && typeof args === 'object' && args.action === 'send' &&
           (typeof args.message === 'string' || Array.isArray(args.attachments)));

        threadOps.patchMessage(threadId, msgId, (m) => {
          if (isMessageTool) {
            const text = typeof args.message === 'string' ? args.message : m.content;
            const atts = attachmentsFromMessageToolArgs(args);
            const isFinal = d.phase === 'result';
            return {
              ...m,
              content:           text,
              attachments:       mergeAttachments(m.attachments, atts),
              waiting:           false,
              streaming:         isFinal ? false : m.streaming,
              thinkingStreaming: false,
            };
          }
          const cards = Array.isArray(m.toolCalls) ? m.toolCalls.slice() : [];
          let card = cards.find((c) => c.id === id);
          if (!card) {
            card = { id, name: d.name || 'tool', args: undefined, output: '', status: 'running' };
            cards.push(card);
          }
          if (d.phase === 'start') {
            card.args   = d.args ?? card.args;
            card.status = 'running';
          } else if (d.phase === 'update') {
            if (d.partialResult != null) card.output = toToolText(d.partialResult);
          } else if (d.phase === 'result') {
            card.output = toToolText(d.result ?? d.partialResult ?? card.output);
            card.status = d.isError ? 'error' : 'done';
          }
          return { ...m, toolCalls: cards, waiting: false };
        });

        // The `message` tool's result IS the end of the turn — don't wait
        // for a state:'final' that may never come. Finalize here.
        if (isMessageTool && d.phase === 'result') { const s = runMapRef.current.get(runId); if (s) clearTimeout(s.watchdog); runMapRef.current.delete(runId); }
        return;
      }

      const deltaText  = payload.deltaText;
      const cumulative = payload.message?.content?.[0]?.text;
      const inboundAtts = extractAttachmentsFromContent(payload.message?.content);

      if (payload.state === 'delta') {
        threadOps.patchMessage(threadId, msgId, (m) => {
          let content;
          if (typeof deltaText === 'string') {
            content = payload.replace ? deltaText : (m.content || '') + deltaText;
          } else {
            content = cumulative ?? m.content;
          }
          const m1 = extractMediaTokens(content);
          return {
            ...m,
            content: m1.cleanedText,
            waiting: false,
            thinkingStreaming: false,
            attachments: mergeAttachments(m.attachments, [...inboundAtts, ...m1.attachments]),
          };
        });
      } else if (payload.state === 'final') {
        threadOps.patchMessage(threadId, msgId, (m) => {
          const rawContent = (typeof cumulative === 'string' && cumulative) ? cumulative : m.content;
          const m1 = extractMediaTokens(rawContent);
          return {
            ...m,
            content: m1.cleanedText,
            streaming: false,
            thinkingStreaming: false,
            waiting: false,
            usage: payload.usage ?? m.usage,
            model: payload.model ?? m.model,
            stopReason: payload.stopReason ?? m.stopReason,
            attachments: mergeAttachments(m.attachments, [...inboundAtts, ...m1.attachments]),
          };
        });
        { const s = runMapRef.current.get(runId); if (s) clearTimeout(s.watchdog); runMapRef.current.delete(runId); }
      } else if (payload.state === 'aborted' || payload.state === 'error') {
        threadOps.patchMessage(threadId, msgId, (m) => ({
          ...m,
          streaming: false,
          thinkingStreaming: false,
          waiting: false,
          isError: payload.state === 'error',
          content: payload.state === 'error' ? (payload.errorMessage || m.content || 'Async reply failed') : m.content,
        }));
        { const s = runMapRef.current.get(runId); if (s) clearTimeout(s.watchdog); runMapRef.current.delete(runId); }
      }
    };

    const unsubscribe = gateway.subscribeToChat(sessionKey, handler);
    return () => {
      unsubscribe();
      for (const entry of runMapRef.current.values()) clearTimeout(entry.watchdog);
    };
  }, [gateway, sessionKey, threadId, threadOps, isSendingRef]);
}
