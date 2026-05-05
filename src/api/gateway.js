// Thin WebSocket client for the OpenClaw control gateway.
//
// Responsibilities:
//   – open / close / auto-reconnect a single socket
//   – perform the connect.challenge handshake
//   – correlate request IDs to in-flight promises (req → res)
//   – broadcast events to subscribers
//
// Everything React-y lives in hooks/useGateway.js — this module is plain JS
// so it can be unit-tested or reused outside React.

import { genId } from '../utils/format.js';

const PROTO_MIN = 3;
const PROTO_MAX = 3;
const PING_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 5_000;
const AUTH_FALLBACK_MS = 3_000;

export class Gateway {
  constructor({ url, getToken, onStatus, onEvent, onSessions, onModels }) {
    this.url        = url;
    this.getToken   = getToken;
    this.onStatus   = onStatus    || noop;
    this.onEvent    = onEvent     || noop;
    this.onSessions = onSessions  || noop;
    this.onModels   = onModels    || noop;

    this.socket    = null;
    this.connecting = false;
    this.authed    = false;
    this.pingTimer = null;
    this.retryTimer = null;
    this.pending   = new Map();   // reqId → { resolve, reject }
  }

  /** Open the socket. Idempotent: existing OPEN/CONNECTING sockets short-circuit. */
  connect() {
    if (this.connecting) return;
    const s = this.socket?.readyState;
    if (s === WebSocket.OPEN || s === WebSocket.CONNECTING) return;

    this.connecting = true;
    clearTimeout(this.retryTimer);
    this.onStatus('connecting');

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen    = () => this._onOpen();
    socket.onmessage = (e) => this._onMessage(e);
    socket.onclose   = ()  => this._onClose();
    socket.onerror   = ()  => this.onStatus('error');
  }

  /** Close + clear timers. The instance can be re-used by calling connect() again. */
  close() {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.connecting = false;
    this.authed = false;
    this.socket?.close();
  }

  /**
   * Send a request and resolve when the matching `res` arrives.
   * If the socket isn't open, the promise rejects immediately — callers
   * should guard with `gateway.isReady()` for non-error cases.
   */
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }
      const id = genId();
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  /** Fire-and-forget request — used for sessions.subscribe, ping, etc. */
  send(method, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'req', id: genId(), method, params }));
  }

  isReady() {
    return this.authed && this.socket?.readyState === WebSocket.OPEN;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  _onOpen() {
    // Some instances skip the challenge; fall back after 3 s.
    setTimeout(() => { if (!this.authed) this._onAuthed(); }, AUTH_FALLBACK_MS);
  }

  _onAuthed() {
    this.authed = true;
    this.connecting = false;
    this.onStatus('on');

    // Initial sync — sessions, models, then keep-alive.
    this.send('sessions.list');
    this.send('sessions.subscribe');
    this.send('models.list');
    this.pingTimer = setInterval(() => this.send('ping'), PING_INTERVAL_MS);
  }

  _onClose() {
    this.connecting = false;
    this.authed = false;
    clearInterval(this.pingTimer);
    this.onStatus('off');
    // Reject any pending requests so callers don't hang forever.
    for (const { reject } of this.pending.values()) {
      reject(new Error('Gateway closed'));
    }
    this.pending.clear();
    this.retryTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  _onMessage({ data }) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    // 1. Auth challenge → respond with our connect params.
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this.socket.send(JSON.stringify({
        type: 'req',
        id: genId(),
        method: 'connect',
        params: {
          minProtocol: PROTO_MIN,
          maxProtocol: PROTO_MAX,
          client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'web', mode: 'ui' },
          auth:   { token: this.getToken() },
          scopes: ['operator.read', 'operator.write'],
        },
      }));
      return;
    }

    // 2. hello-ok → authenticated.
    if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
      this._onAuthed();
      return;
    }

    // 3. Pending request response — resolve / reject the matching promise.
    if (msg.type === 'res' && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.ok ? resolve(msg.payload) : reject(new Error(msg.payload?.message ?? 'Gateway error'));
      return;
    }

    // 4. Generic error response (no matching pending request).
    if (msg.type === 'res' && !msg.ok) {
      console.warn('[gateway] error response:', msg.payload ?? msg);
      return;
    }

    // 5. Models list (sometimes arrives unsolicited after auth).
    if (msg.type === 'res' && msg.ok && Array.isArray(msg.payload?.models)) {
      this.onModels(msg.payload.models);
      return;
    }

    // 6. Sessions list — fire-and-forget responses.
    if (msg.type === 'res' && msg.ok) {
      const items = msg.payload?.items ?? msg.payload?.sessions
                   ?? (Array.isArray(msg.payload) ? msg.payload : null);
      if (Array.isArray(items)) this.onSessions(items);
      return;
    }

    // 7. Server events — refresh sessions on any event after auth.
    if (msg.type === 'event') {
      this.onEvent(msg);
      if (this.authed) this.send('sessions.list');
    }
  }
}

function noop() {}
