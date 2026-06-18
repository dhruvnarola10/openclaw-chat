// Send a chat turn.
//
// Two paths:
//   1. Direct WS — preferred when the gateway is connected. Calls
//      `sessions.patch` to set the chosen model (so users CAN switch
//      models, unlike the /v1/responses HTTP path), then `chat.send`
//      and listens for `event:"chat"` deltas to stream the reply.
//
//   2. HTTP fallback — used when the WS isn't authed. POSTs to the
//      OpenResponses endpoint and reads the SSE stream. The body's
//      `model` field is locked to `openclaw` / `openclaw/<agentId>`
//      so the gateway accepts it.
//
// Both paths funnel through the same `threadOps.patchLast` interface,
// so the rest of the UI doesn't care which one ran.

import { useCallback, useRef, useState } from 'react';
import { postResponses, readSseStream } from '../api/http.js';
import { attachmentsFromMessageToolArgs, buildInputContent, extractAttachmentsFromContent, extractMediaTokens } from '../utils/files.js';
import { genId } from '../utils/format.js';

// Tool results arrive in several shapes (string, { text }, array of
// { text }, arbitrary object). Coerce to a displayable string the same
// way OpenClaw's own webchat does.
// Dedupe inbound attachments by id, preferring the freshest (later) copy —
// streaming events may re-deliver the same image as the message grows.
function mergeAttachments(existing, incoming) {
  if (!incoming?.length) return existing;
  const byId = new Map();
  for (const a of existing ?? []) byId.set(a.id, a);
  for (const a of incoming)      byId.set(a.id, a);
  return Array.from(byId.values());
}

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

export function useChat({ apiUrl, token, agentId, model, stream, gateway, threadOps }) {
  const [loading, setLoading] = useState(false);
  const abortRef     = useRef(null);  // for HTTP path
  const wsActiveRef  = useRef(null);  // { sessionKey, unsubscribe } for WS path

  const send = useCallback(async (input) => {
    const text        = typeof input === 'string' ? input : input?.text ?? '';
    const attachments = typeof input === 'string' ? []   : (input?.attachments ?? []);
    if ((!text && attachments.length === 0) || loading) return;

    const isCommand = text.startsWith('/');
    const { threadId, sessionKey: rawSessionKey } = threadOps.startTurn({ text, isCommand, attachments });

    // Hard guarantee: never call the gateway with a missing key. The OpenClaw
    // gateway rejects chat.send with `at /sessionKey: must be string` and we
    // surface an obscure red bubble — fix it here instead.
    const sessionKey = (typeof rawSessionKey === 'string' && rawSessionKey)
      ? rawSessionKey
      : `agent:${agentId || 'main'}:web:${threadId}`;
    if (sessionKey !== rawSessionKey) {
      console.warn('[chat] startTurn returned invalid sessionKey, falling back:', { rawSessionKey, sessionKey });
    }

    setLoading(true);

    // If the WS gateway isn't connected, the chat falls back to the HTTP
    // OpenResponses endpoint — which on flaky mobile networks frequently
    // dies with "Failed to fetch". Prefer the WS path: if it's not ready
    // but the gateway exists, kick a reconnect and wait briefly for it to
    // come up before we resort to HTTP.
    const wsLive = () => (typeof gateway?.isReady === 'function' ? gateway.isReady() : gateway?.status === 'on');
    if (!wsLive() && gateway?.reconnect && gateway?.subscribeToChat) {
      console.warn('[chat] gateway WS not ready — attempting reconnect before send');
      try { gateway.reconnect(); } catch { /* ignore */ }
      const deadline = Date.now() + 4000;
      while (!wsLive() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      console.warn(`[chat] after reconnect wait: wsLive=${wsLive()}`);
    }

    const useWs = wsLive() && !!gateway?.subscribeToChat;

    // OpenClaw's embedded runner sometimes fails a turn with a transient
    // race — "session file changed while embedded prompt lock was released"
    // / EmbeddedAttemptSessionTakeoverError. It happens when an internal
    // write (compaction, memory sync, maintenance) touches the session
    // JSONL while the prompt lock is briefly released. It's NOT a real
    // failure — a retry almost always succeeds. Detect it and retry a
    // couple times with a short backoff instead of surfacing a scary error.
    const isTransientSessionRace = (msg) =>
      typeof msg === 'string' && (
        /session file changed while embedded prompt lock/i.test(msg) ||
        /EmbeddedAttemptSessionTakeoverError/i.test(msg) ||
        /session takeover/i.test(msg)
      );

    const runOnce = () => (useWs && attachments.length === 0)
      ? sendViaWs({ gateway, sessionKey, threadId, text, model, threadOps, wsActiveRef })
      : sendViaHttp({ apiUrl, token, agentId, sessionKey, threadId, text, attachments, model, stream, threadOps, abortRef });

    const MAX_RETRIES = 3;
    try {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await runOnce();
          break;
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          if (isTransientSessionRace(err?.message) && attempt < MAX_RETRIES) {
            attempt += 1;
            console.warn(`[chat] transient session race — retry ${attempt}/${MAX_RETRIES}`);
            // Reset the assistant bubble back to a clean "waiting" state and
            // wait a beat for OpenClaw's internal write to settle.
            threadOps.patchLast(threadId, (m) => ({
              ...m, content: '', toolCalls: undefined, streaming: true,
              thinkingStreaming: false, waiting: true, isError: false,
            }));
            await new Promise((r) => setTimeout(r, 600 * attempt));
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        threadOps.patchLast(threadId, (m) => ({
          ...m, streaming: false, thinkingStreaming: false, waiting: false,
        }));
      } else {
        threadOps.patchLast(threadId, (m) => ({
          ...m,
          content: formatChatError(err.message, model),
          streaming: false, thinkingStreaming: false, waiting: false, isError: true,
        }));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [apiUrl, token, agentId, model, stream, gateway, loading, threadOps]);

  const stop = useCallback(() => {
    // HTTP path — synchronous, throws AbortError → caught by send()'s catch.
    abortRef.current?.abort();

    // WS path — tell the gateway to stop the run AND finalise the bubble
    // locally so the user gets instant feedback. abort() (set up inside
    // sendViaWs) patches the message non-streaming, resolves the pending
    // donePromise, and cleans up the subscription. Without this last step,
    // setLoading(false) never runs (the `finally` clause waits on
    // donePromise) and the pause button stays stuck forever.
    const ws = wsActiveRef.current;
    if (ws) {
      gateway?.request?.('chat.abort', { sessionKey: ws.sessionKey }).catch(() => {});
      ws.abort?.();
    }
  }, [gateway]);

  return { send, stop, loading };
}

// ── WS path ─────────────────────────────────────────────────────────────

async function sendViaWs({ gateway, sessionKey, threadId, text, model, threadOps, wsActiveRef }) {
  // Guard: refuse to call `sessions.patch` without a valid sessionKey.
  // This used to throw "INVALID_REQUEST: at /key: must be string" when an
  // older thread was missing its sessionKey — useThreads.startTurn now
  // self-heals that, but we still defensively skip if it's not a string.
  const hasKey = typeof sessionKey === 'string' && sessionKey.length > 0;

  // 1. Set the model on the session via `sessions.patch`. The model field
  //    is the only way to override which provider model `chat.send` uses —
  //    `chat.send` itself has no model param. The gateway runs the value
  //    through `resolveAllowedModelRef` which expects either a bare model
  //    id or a `provider:model` reference present in its catalog.
  //
  //    Errors here are real (e.g. "model not in catalog", "webchat clients
  //    cannot patch sessions") — surface them to the user so they don't
  //    silently get the default model when their pick wasn't applied.
  const isRoutingId = !model || model === 'openclaw' || /^openclaw\//.test(model);
  let resolvedModel = isRoutingId ? null : model;
  if (!isRoutingId && hasKey) {
    try {
      const resp = await gateway.request('sessions.patch', { key: sessionKey, model });
      resolvedModel = resp?.resolved?.model ?? resp?.entry?.modelOverride ?? model;
      if (resolvedModel !== model) {
        console.info(`[chat] model "${model}" resolved to "${resolvedModel}"`);
      }
    } catch (e) {
      // Show the error inline as the assistant reply so the user sees
      // exactly why their model pick didn't apply.
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        content: `Couldn't apply model "${model}":\n${e.message}\n\n` +
                 `Try a model id from the gateway's catalog ` +
                 `(e.g. "provider:model" form), or pick "openclaw" to use the agent default.`,
        streaming: false,
        thinkingStreaming: false,
        waiting: false,
        isError: true,
      }));
      return;
    }
  }

  // 2. Subscribe to chat events for this session BEFORE sending.
  let runId  = null;
  let donePromise;
  let resolveDone, rejectDone;
  donePromise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

  const handler = (payload) => {
    // Lock onto the first runId we see so we ignore unrelated runs.
    if (runId == null) runId = payload.runId;
    if (payload.runId !== runId) return;

    // ── Tool-stream events (protocol v4) ──────────────────────────────
    // Shape: { stream:"tool", runId, sessionKey, ts,
    //          data:{ toolCallId, name, phase, args, partialResult, result } }
    // phase: "start" (args) → "update" (partialResult) → "result" (result).
    // We keep a card per toolCallId on the message so Message.jsx can
    // render the call + output blocks BEFORE the assistant text.
    if (payload.stream === 'tool') {
      const d = payload.data ?? {};
      const id = d.toolCallId || `${d.name}:tool`;
      // The `message` tool IS the visible reply — its args carry the text
      // and attachments the user should see. Don't render a redundant card;
      // hoist its content onto the message instead and finalize on result.
      // Match by name OR by argument shape — different gateway builds emit
      // it under slightly different names (message, message.send, etc).
      const args = d.args ?? {};
      const isMessageTool =
        d.name === 'message' || d.name === 'message.send' ||
        (args && typeof args === 'object' && args.action === 'send' &&
         (typeof args.message === 'string' || Array.isArray(args.attachments)));

      threadOps.patchLast(threadId, (m) => {
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
      return;
    }

    // Protocol v4 streams text as `payload.deltaText` (incremental;
    // `replace:true` resets the running text). Older v3 gateways only sent
    // the cumulative `message.content[0].text`. Handle both: prefer the
    // incremental delta, fall back to cumulative.
    const deltaText  = payload.deltaText;
    const cumulative = payload.message?.content?.[0]?.text;

    // Non-text content parts (images, files) can ride alongside the text in
    // `payload.message.content[]`. Pull them out once per event and let the
    // patchers merge them in.
    const inboundAtts = extractAttachmentsFromContent(payload.message?.content);

    if (payload.state === 'delta') {
      threadOps.patchLast(threadId, (m) => {
        let content;
        if (typeof deltaText === 'string') {
          content = payload.replace ? deltaText : (m.content || '') + deltaText;
        } else {
          content = cumulative ?? m.content;   // legacy v3 cumulative shape
        }
        // Strip MEDIA:<path> tokens out of the running text and surface
        // them as attachments (image_generate etc. write paths into text).
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
      threadOps.patchLast(threadId, (m) => {
        const rawContent = (typeof cumulative === 'string' && cumulative) ? cumulative : m.content;
        const m1 = extractMediaTokens(rawContent);
        return {
          ...m,
          content: m1.cleanedText,
          streaming: false,
          thinkingStreaming: false,
          waiting: false,
          usage: payload.usage ?? m.usage,
          model: resolvedModel ?? payload.model ?? m.model,
          stopReason: payload.stopReason ?? m.stopReason,
          attachments: mergeAttachments(m.attachments, [...inboundAtts, ...m1.attachments]),
        };
      });
      // The chat event's `usage` field is often empty — the official
      // dashboard pulls token counts from sessions.usage.timeseries
      // separately. Mirror that here so the meta row populates.
      fetchSessionUsage(gateway, sessionKey)
        .then((u) => {
          if (!u) return;
          threadOps.patchLast(threadId, (m) => ({ ...m, usage: { ...(m.usage || {}), ...u } }));
        })
        .catch(() => { /* silently ignore — already have what we have */ });
      cleanup();
      resolveDone();
    } else if (payload.state === 'aborted') {
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        streaming: false,
        thinkingStreaming: false,
        waiting: false,
      }));
      cleanup();
      resolveDone();
    } else if (payload.state === 'error') {
      cleanup();
      rejectDone(new Error(payload.errorMessage || 'Gateway chat error'));
    }
  };

  const unsubscribe = gateway.subscribeToChat(sessionKey, handler);
  const cleanup = () => {
    unsubscribe();
    if (wsActiveRef.current?.sessionKey === sessionKey) wsActiveRef.current = null;
  };

  // Stop() must be able to finalise the bubble locally — we cannot rely on
  // the gateway emitting `state:'aborted'` for us, because the user clicking
  // pause needs immediate visual feedback AND because some gateway runs
  // (subagent, async tool waits) never emit a closing event after a chat.abort.
  // The HTTP path gets this for free via AbortController; do the equivalent
  // here so `await donePromise` returns and the `setLoading(false)` finally
  // runs. Any future events on this runId land on no subscriber, harmless.
  const abortLocal = () => {
    threadOps.patchLast(threadId, (m) => ({
      ...m,
      streaming:         false,
      thinkingStreaming: false,
      waiting:           false,
    }));
    cleanup();
    resolveDone();
  };
  wsActiveRef.current = { sessionKey, unsubscribe: cleanup, abort: abortLocal };

  // 3. Send. The server's response is just an ack — the actual reply comes
  //    via the chat events we just subscribed to.
  try {
    await gateway.request('chat.send', {
      sessionKey,
      message: text,
      idempotencyKey: genId(),
      deliver: false,   // keep reply in-app, don't echo to bound channels
    });
  } catch (e) {
    cleanup();
    throw e;
  }

  // 4. Wait for the terminal event (final / aborted / error).
  await donePromise;
}

// ── HTTP fallback ───────────────────────────────────────────────────────

async function sendViaHttp({
  apiUrl, token, agentId, sessionKey, threadId, text, attachments,
  model, stream, threadOps, abortRef,
}) {
  abortRef.current = new AbortController();

  // Body's `model` MUST be openclaw / openclaw/<agentId> for HTTP path.
  // (Provider-specific ids cause 400s from the OpenResponses endpoint.)
  const safeModel =
    !model || model === 'openclaw' || /^openclaw\//.test(model)
      ? model || (agentId ? `openclaw/${agentId}` : 'openclaw')
      : (agentId ? `openclaw/${agentId}` : 'openclaw');

  const res = await postResponses({
    apiUrl, token, agentId, sessionKey,
    body: {
      model: safeModel,
      stream,
      input: buildInputContent(text, attachments),
    },
    signal: abortRef.current.signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const bodyText = await res.text();
      try {
        const j = JSON.parse(bodyText);
        detail = j?.error?.message ?? j?.message ?? bodyText;
      } catch { detail = bodyText; }
    } catch { detail = res.statusText; }
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${detail}`.trim());
  }
  if (!res.body) throw new Error('No response body');

  await readSseStream(res, ({ type, payload }) => {
    if (/thinking|reasoning/.test(type) && !type.includes('done')) {
      const d = payload.delta ?? payload.thinking ?? payload.reasoning ?? '';
      if (d) {
        threadOps.patchLast(threadId, (m) => ({
          ...m,
          thinking: (m.thinking || '') + d,
          thinkingStreaming: true,
          waiting: false,
        }));
      }
    }
    if (/thinking|reasoning/.test(type) && type.includes('done')) {
      threadOps.patchLast(threadId, (m) => ({ ...m, thinkingStreaming: false }));
    }
    if (type === 'response.output_text.delta' && payload.delta) {
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        content: m.content + payload.delta,
        waiting: false,
        thinkingStreaming: false,
      }));
    }
    // Capture usage + model on completion.
    if (type === 'response.completed' && payload.response) {
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        usage: payload.response.usage ?? m.usage,
        model: payload.response.model ?? m.model,
      }));
    }
  });

  threadOps.patchLast(threadId, (m) => ({
    ...m, streaming: false, thinkingStreaming: false, waiting: false,
  }));
}

// ── Usage backfill ─────────────────────────────────────────────────────
//
// The OpenClaw `chat` event has `usage?: unknown` — most builds leave it
// empty. The built-in dashboard fetches `sessions.usage.timeseries` after
// each turn and reads the latest point for {input, output, totalTokens,
// cumulativeTokens, cost}. We mirror that here so the meta row populates.
//
// We pull both the timeseries and the cost rollup so we can compute the
// "X% ctx" figure when the gateway exposes a model max-context.
async function fetchSessionUsage(gateway, sessionKey) {
  if (!gateway?.request) return null;

  // Race a 4s timeout — usage data isn't worth blocking on.
  const timeout = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
  ]);

  let series = null;
  try {
    series = await timeout(gateway.request('sessions.usage.timeseries', { key: sessionKey }));
  } catch { /* fall through */ }

  // Newer builds expose `sessions.usage` with per-session totals.
  let summary = null;
  try {
    summary = await timeout(gateway.request('sessions.usage', { key: sessionKey, limit: 1 }));
  } catch { /* fall through */ }

  const last  = series?.points?.[series.points.length - 1];
  const entry = summary?.sessions?.find?.((s) => s.key === sessionKey)
             ?? summary?.sessions?.[0];
  const u     = entry?.usage ?? null;

  // Prefer the last timeseries point for per-turn output, fall back to totals.
  const out = {};
  const input  = last?.input         ?? u?.input;
  const output = last?.output        ?? u?.output;
  const cacheR = last?.cacheRead     ?? u?.cacheRead;
  const cacheW = last?.cacheWrite    ?? u?.cacheWrite;
  const total  = last?.totalTokens   ?? u?.totalTokens;
  const cumul  = last?.cumulativeTokens;
  const ctxPct = entry?.usage?.contextPercent ?? entry?.contextWeight?.usagePercent;

  if (input  != null) out.input  = Number(input);
  if (output != null) out.output = Number(output);
  if (cacheR != null) out.cacheRead  = Number(cacheR);
  if (cacheW != null) out.cacheWrite = Number(cacheW);
  if (total  != null) out.totalTokens      = Number(total);
  if (cumul  != null) out.cumulativeTokens = Number(cumul);
  if (ctxPct != null) out.contextPct = Math.round(Number(ctxPct));

  return Object.keys(out).length ? out : null;
}

// Format a chat error for the assistant bubble. Picks the right "Try"
// hints based on the error category so users don't see "check the bearer
// token" advice when the actual problem is a 404 from a model provider.
function formatChatError(message, model) {
  const text = (message || '').toLowerCase();

  // OpenClaw embedded-runner session race (known upstream bug). If it
  // survived our auto-retries, explain it plainly rather than dumping the
  // raw "embedded prompt lock" jargon.
  if (/session file changed while embedded prompt lock|embeddedattemptsessiontakeover|session takeover/i.test(message || '')) {
    return `The agent hit a temporary session conflict and couldn't complete this turn.\n\n` +
           `This is a known OpenClaw issue where a background write (compaction / memory sync) ` +
           `touches the session file mid-reply. It usually clears on its own.\n\n` +
           `Try:\n` +
           `• Send the message again\n` +
           `• If it keeps happening, start a new chat (the session file may be busy)`;
  }

  // Provider-side errors — model not in upstream catalog, region issues, etc.
  if (/\b(404|not[\s-]?found|unknown[\s-]?model|model.*not.*exist|invalid[\s-]?model)\b/.test(text)
      || /generative ai api error/i.test(message || '')) {
    return `${message}\n\n` +
           `The gateway accepted "${model}" but the upstream provider doesn't recognise it.\n` +
           `Try:\n` +
           `• Picking a different model from the dropdown\n` +
           `• Confirming the gateway's model catalog matches what the provider currently exposes`;
  }

  // Auth / quota
  if (/\b(401|403|unauthor|forbidden|quota|rate[\s-]?limit|exhausted)\b/.test(text)) {
    return `${message}\n\n` +
           `Try:\n` +
           `• Checking the API key for the model's provider on the gateway side\n` +
           `• Waiting and retrying if rate-limited`;
  }

  // Connection / gateway-level
  if (/\b(gateway closed|disconnect|timeout|econnrefused|fetch failed|missing scope)\b/.test(text)) {
    return `${message}\n\n` +
           `Check:\n` +
           `• Gateway connected (Overview page)\n` +
           `• Bearer token correct\n` +
           `• Agent ID valid`;
  }

  // Default — keep the original generic checklist.
  return `${message}\n\n` +
         `Check:\n` +
         `• Gateway connected (Overview page)\n` +
         `• Bearer token correct\n` +
         `• Agent ID valid`;
}
