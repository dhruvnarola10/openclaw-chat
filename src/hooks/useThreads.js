// Persistent thread store. Each thread holds its own message list plus
// a sessionKey so the server can correlate it with remote channels.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clip, genId, parseSessionKey } from '../utils/format.js';
import { channelMeta } from '../utils/channels.js';
import { load, save } from '../utils/storage.js';

export function useThreads({ agentId }) {
  const [threads,  setThreads]  = useState(() => load('oc-threads',  []));
  const [activeId, setActiveId] = useState(() => load('oc-activeId', null));

  useEffect(() => save('oc-threads',  threads),  [threads]);
  useEffect(() => save('oc-activeId', activeId), [activeId]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId],
  );

  // ── Mutators ──────────────────────────────────────────────────────────

  const newThread = useCallback(() => {
    const current = threads.find((t) => t.id === activeId);
    if (current && current.messages.length === 0) return current.id;
    const id = genId();
    const thread = {
      id,
      title: '',
      sessionKey: `agent:${agentId}:web:${id}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setThreads((prev) => [thread, ...prev]);
    setActiveId(id);
    return id;
  }, [threads, activeId, agentId]);

  const switchThread = useCallback((id) => setActiveId(id), []);

  const deleteThread = useCallback((id) => {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    setActiveId((curr) => {
      if (curr !== id) return curr;
      const remaining = threads.filter((t) => t.id !== id);
      return remaining[0]?.id ?? null;
    });
  }, [threads]);

  const renameThread = useCallback((id, title) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  /** Replace a thread's messages wholesale (used after fetching history). */
  const setMessages = useCallback((id, messages) => {
    setThreads((prev) => prev.map((t) =>
      t.id === id ? { ...t, messages, updatedAt: Date.now() } : t,
    ));
  }, []);

  /** Append the user + assistant placeholder pair, returning the thread id. */
  const startTurn = useCallback(({ text, isCommand, attachments }) => {
    const userMsg = {
      id: genId(),
      role: 'user',
      content: text,
      isCommand,
      attachments: attachments?.length ? attachments : undefined,
    };
    const asstId  = genId();
    const asstMsg = {
      id: asstId, role: 'assistant', content: '', thinking: '',
      streaming: true, thinkingStreaming: false, waiting: true,
      isError: false, isCommand,
    };
    const titleText = isCommand ? '' : clip(text, 38);

    let resolvedThreadId = activeId;
    let resolvedSessionKey = null;

    setThreads((prev) => {
      const existing = prev.find((t) => t.id === activeId);
      if (existing) {
        resolvedThreadId   = existing.id;
        // Self-heal: older threads in localStorage may have no sessionKey.
        // Generate one and persist it back so subsequent sends don't break.
        resolvedSessionKey = (typeof existing.sessionKey === 'string' && existing.sessionKey)
          ? existing.sessionKey
          : `agent:${agentId}:web:${existing.id}`;
        return prev.map((t) => t.id !== existing.id ? t : {
          ...t,
          sessionKey: resolvedSessionKey,
          title: t.title || titleText,
          updatedAt: Date.now(),
          messages: [...t.messages, userMsg, asstMsg],
        });
      }
      const id = genId();
      resolvedThreadId   = id;
      resolvedSessionKey = `agent:${agentId}:web:${id}`;
      return [
        {
          id, title: titleText, sessionKey: resolvedSessionKey,
          messages: [userMsg, asstMsg], createdAt: Date.now(), updatedAt: Date.now(),
        },
        ...prev,
      ];
    });

    if (resolvedThreadId !== activeId) setActiveId(resolvedThreadId);
    return { threadId: resolvedThreadId, sessionKey: resolvedSessionKey, asstId };
  }, [activeId, agentId]);

  /** Apply a transform to the last assistant message of `threadId`. */
  const patchLast = useCallback((threadId, transform) => {
    setThreads((prev) => prev.map((t) => {
      if (t.id !== threadId) return t;
      const last = t.messages[t.messages.length - 1];
      if (!last || last.role !== 'assistant') return t;
      return {
        ...t,
        updatedAt: Date.now(),
        messages: [...t.messages.slice(0, -1), transform(last)],
      };
    }));
  }, []);

  /**
   * Find or create a local thread for a remote session key. Returns the
   * thread id so the caller can fetch history immediately afterwards.
   */
  const ensureThreadForSession = useCallback((sessionKey) => {
    const existing = threads.find((t) => t.sessionKey === sessionKey);
    if (existing) {
      setActiveId(existing.id);
      return existing.id;
    }
    const { channel, peer } = parseSessionKey(sessionKey);
    const meta  = channelMeta(channel);
    const id    = genId();
    const title = `${meta.label} · ${clip(peer, 24)}`;
    setThreads((prev) => [
      { id, title, sessionKey, messages: [], createdAt: Date.now(), updatedAt: Date.now() },
      ...prev,
    ]);
    setActiveId(id);
    return id;
  }, [threads]);

  const clearAll = useCallback(() => {
    setThreads([]);
    setActiveId(null);
  }, []);

  return {
    threads, activeId, activeThread,
    newThread, switchThread, deleteThread, renameThread,
    setMessages, startTurn, patchLast, ensureThreadForSession, clearAll,
  };
}
