// React wrapper around api/gateway.js. Owns WS lifecycle, session list,
// and the history-fetch entrypoint used by the Sessions panel.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Gateway } from '../api/gateway.js';
import { genId, parseSessionKey } from '../utils/format.js';

const MAX_EVENTS = 50;

export function useGateway({ tokenRef, onModelsList }) {
  const [status,   setStatus]   = useState('off');
  const [sessions, setSessions] = useState([]);
  const [events,   setEvents]   = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(() => new Set());

  const gatewayRef = useRef(null);
  const onModelsRef = useRef(onModelsList);
  useEffect(() => { onModelsRef.current = onModelsList; }, [onModelsList]);

  const pushEvent = useCallback((kind, summary, meta) => {
    setEvents((prev) => [{ ts: Date.now(), kind, summary, meta }, ...prev].slice(0, MAX_EVENTS));
  }, []);

  // Chat-stream subscribers: sessionKey → Set<handler>. Used by useChat
  // to receive `event: "chat"` deltas for an in-flight `chat.send`.
  const chatSubsRef = useRef(new Map());
  const subscribeToChat = useCallback((sessionKey, handler) => {
    let set = chatSubsRef.current.get(sessionKey);
    if (!set) {
      set = new Set();
      chatSubsRef.current.set(sessionKey, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (!set.size) chatSubsRef.current.delete(sessionKey);
    };
  }, []);

  // Build the gateway once and keep its callbacks stable via refs.
  if (!gatewayRef.current) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    gatewayRef.current = new Gateway({
      url: `${proto}://${location.host}/ws`,
      getToken: () => tokenRef.current,
      onStatus: (s) => {
        setStatus(s);
        pushEvent(s, `gateway ${s}`);
      },
      onModels: (m) => {
        onModelsRef.current?.(m);
        pushEvent('models', `models.list · ${m?.length ?? 0} models`);
      },
      onSessions: (raw) => {
        const list = raw.map((s) => {
          const parsed = parseSessionKey(s.key ?? '');
          return {
            key:       s.key ?? '',
            channel:   s.channel ?? parsed.channel,
            peer:      s.displayName ?? parsed.peer,
            agentId:   parsed.agentId,
            kind:      s.kind,
            updatedAt: s.updatedAt,
          };
        });
        setSessions(list);
      },
      onEvent: (msg) => {
        // Only log named events, not every protocol frame.
        if (msg.event && msg.event !== 'connect.challenge' && msg.event !== 'chat') {
          pushEvent('event', msg.event);
        }
      },
      onChat: (payload) => {
        const subs = chatSubsRef.current.get(payload.sessionKey);
        if (!subs) return;
        for (const h of subs) {
          try { h(payload); } catch (e) { console.warn('[gateway] chat handler threw:', e); }
        }
      },
    });
  }

  // Connect on mount, close on unmount.
  useEffect(() => {
    const gw = gatewayRef.current;
    gw.connect();
    return () => gw.close();
  }, []);

  // Tabs put to sleep stop firing the ping/stale timers — when the tab
  // wakes up the WS may already be half-dead. Force a status check and
  // reconnect on visibility-change / online events.
  useEffect(() => {
    const kick = () => {
      const gw = gatewayRef.current;
      if (!gw) return;
      const s = gw.socket?.readyState;
      if (s === WebSocket.CLOSED || s === WebSocket.CLOSING || s === undefined) {
        gw.connect();
      }
    };
    const onVis    = () => { if (document.visibilityState === 'visible') kick(); };
    const onOnline = () => kick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const reconnect = useCallback(() => gatewayRef.current?.connect(), []);
  // Explicit user-initiated disconnect — sets manuallyClosed on the
  // underlying Gateway so _onClose won't auto-reconnect after 5s.
  const disconnect = useCallback(() => gatewayRef.current?.close(), []);

  /**
   * Request the message transcript for a given sessionKey via WS chat.history
   * and call `onMessages(rawMessages)` once the server responds.
   * `threadId` is used purely to track the loading-spinner state.
   */
  const fetchHistory = useCallback(async (sessionKey, threadId, onMessages) => {
    const gw = gatewayRef.current;
    if (!gw?.isReady()) return;

    setLoadingHistory((p) => new Set([...p, threadId]));
    try {
      const payload = await gw.request('chat.history', { sessionKey, limit: 200 });
      const raw = payload?.messages ?? payload?.items ?? [];
      onMessages?.(raw.flatMap(normalizeHistoryMessage));
    } catch (err) {
      console.warn('[gateway] chat.history failed:', err.message);
    } finally {
      setLoadingHistory((p) => { const s = new Set(p); s.delete(threadId); return s; });
    }
  }, []);

  /** Fire a generic gateway request, returning the payload promise. */
  const request = useCallback(
    (method, params) => gatewayRef.current?.request(method, params),
    [],
  );

  /**
   * Preflight: ask the gateway whether a restart would be disruptive right
   * now. Returns { safe, counts, blockers, summary } per the openclaw
   * restart-coordinator. Cheap RPC (operator.read scope).
   */
  const restartPreflight = useCallback(
    () => gatewayRef.current?.request('gateway.restart.preflight', {}),
    [],
  );

  /**
   * Send a SIGUSR1-based restart request to the gateway. Requires the
   * operator.admin scope — which our control-UI connect already requests.
   * The gateway responds *before* dropping the WS, so the caller sees
   * { ok, status: 'scheduled'|'deferred'|'coalesced' } first, then the
   * existing _onClose auto-reconnect loop will tick our status back to
   * 'on' once the gateway is back up.
   */
  const restartGateway = useCallback(
    (reason = 'manual UI restart') =>
      gatewayRef.current?.request('gateway.restart.request', { reason }),
    [],
  );

  return {
    status, sessions, events, loadingHistory,
    fetchHistory, reconnect, disconnect, request,
    restartPreflight, restartGateway,
    subscribeToChat,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizeHistoryMessage(item) {
  const m = item.message ?? item;
  if (!m?.role || m.role === 'tool' || m.role === 'toolResult') return [];

  let content  = '';
  let thinking = '';
  if (Array.isArray(m.content)) {
    for (const c of m.content) {
      if (c.type === 'text') content += c.text ?? '';
      else if (c.type === 'thinking' || c.type === 'reasoning')
        thinking += c.thinking ?? c.text ?? '';
    }
  } else if (typeof m.content === 'string') {
    content = m.content;
  }
  if (!content && !thinking) return [];

  return [{
    id:       item.id ?? m.id ?? genId(),
    role:     m.role,
    content,
    thinking: thinking || undefined,
  }];
}
