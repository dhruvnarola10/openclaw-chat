// Owns the streaming send-message logic. Intentionally narrow: takes the
// thread mutators it needs and the runtime config, and exposes { send, stop }.

import { useCallback, useRef, useState } from 'react';
import { postResponses, readSseStream } from '../api/http.js';
import { buildInputContent } from '../utils/files.js';

export function useChat({ apiUrl, token, agentId, model, stream, threadOps }) {
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  /**
   * Send a user turn. Accepts either a plain string (legacy) or
   * `{ text, attachments }` for multimodal input.
   */
  const send = useCallback(async (input) => {
    const text        = typeof input === 'string' ? input : input?.text ?? '';
    const attachments = typeof input === 'string' ? []   : (input?.attachments ?? []);
    if ((!text && attachments.length === 0) || loading) return;

    const isCommand = text.startsWith('/');
    const { threadId, sessionKey } = threadOps.startTurn({ text, isCommand, attachments });

    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await postResponses({
        apiUrl, token, agentId, sessionKey,
        body: {
          model,
          stream,
          input: buildInputContent(text, attachments),
        },
        signal: abortRef.current.signal,
      });
      if (!res.ok) {
        // Read the response body so the user sees what the gateway actually
        // complained about (e.g. "model not configured", "agent not found").
        let detail = '';
        try {
          const bodyText = await res.text();
          // Try JSON first; fall back to raw text.
          try {
            const j = JSON.parse(bodyText);
            detail = j?.error?.message ?? j?.message ?? bodyText;
          } catch {
            detail = bodyText;
          }
        } catch {
          detail = res.statusText;
        }
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
      });

      threadOps.patchLast(threadId, (m) => ({
        ...m, streaming: false, thinkingStreaming: false, waiting: false,
      }));
    } catch (err) {
      if (err.name === 'AbortError') {
        threadOps.patchLast(threadId, (m) => ({
          ...m, streaming: false, thinkingStreaming: false, waiting: false,
        }));
        return;
      }
      threadOps.patchLast(threadId, (m) => ({
        ...m,
        content: `${err.message}\n\nCheck:\n• API running at ${apiUrl}\n• Bearer token correct\n• Agent ID valid`,
        streaming: false, thinkingStreaming: false, waiting: false, isError: true,
      }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [apiUrl, token, agentId, model, stream, loading, threadOps]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { send, stop, loading };
}
