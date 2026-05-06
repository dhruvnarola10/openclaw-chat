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
import { buildInputContent } from '../utils/files.js';
import { genId } from '../utils/format.js';

export function useChat({ apiUrl, token, agentId, model, stream, gateway, threadOps }) {
  const [loading, setLoading] = useState(false);
  const abortRef     = useRef(null);  // for HTTP path
  const wsActiveRef  = useRef(null);  // { sessionKey, unsubscribe } for WS path

  const send = useCallback(async (input) => {
    const text        = typeof input === 'string' ? input : input?.text ?? '';
    const attachments = typeof input === 'string' ? []   : (input?.attachments ?? []);
    if ((!text && attachments.length === 0) || loading) return;

    const isCommand = text.startsWith('/');
    const { threadId, sessionKey } = threadOps.startTurn({ text, isCommand, attachments });

    setLoading(true);

    const useWs = gateway?.status === 'on' && !!gateway?.subscribeToChat;
    try {
      if (useWs && attachments.length === 0) {
        await sendViaWs({
          gateway, sessionKey, threadId, text, model, threadOps, wsActiveRef,
        });
      } else {
        await sendViaHttp({
          apiUrl, token, agentId, sessionKey, threadId, text, attachments,
          model, stream, threadOps, abortRef,
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        threadOps.patchLast(threadId, (m) => ({
          ...m, streaming: false, thinkingStreaming: false, waiting: false,
        }));
      } else {
        threadOps.patchLast(threadId, (m) => ({
          ...m,
          content: `${err.message}\n\nCheck:\n• Gateway connected (Overview page)\n• Bearer token correct\n• Agent ID valid`,
          streaming: false, thinkingStreaming: false, waiting: false, isError: true,
        }));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [apiUrl, token, agentId, model, stream, gateway, loading, threadOps]);

  const stop = useCallback(() => {
    // Abort whichever path is in flight.
    abortRef.current?.abort();
    const ws = wsActiveRef.current;
    if (ws) {
      gateway?.request?.('chat.abort', { sessionKey: ws.sessionKey }).catch(() => {});
      ws.unsubscribe?.();
      wsActiveRef.current = null;
    }
  }, [gateway]);

  return { send, stop, loading };
}

// ── WS path ─────────────────────────────────────────────────────────────

async function sendViaWs({ gateway, sessionKey, threadId, text, model, threadOps, wsActiveRef }) {
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
  if (!isRoutingId) {
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

    const text = payload.message?.content?.[0]?.text ?? '';

    if (payload.state === 'delta') {
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        content: text,                 // cumulative — replace, not append
        waiting: false,
        thinkingStreaming: false,
      }));
    } else if (payload.state === 'final') {
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        content: text || m.content,
        streaming: false,
        thinkingStreaming: false,
        waiting: false,
        usage: payload.usage ?? m.usage,
        model: resolvedModel ?? payload.model ?? m.model,
        stopReason: payload.stopReason ?? m.stopReason,
      }));
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
  wsActiveRef.current = { sessionKey, unsubscribe: cleanup };

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
