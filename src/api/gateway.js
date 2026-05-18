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

// OpenClaw bumped the wire protocol to v4 (MIN_CLIENT_PROTOCOL_VERSION = 4);
// v3 was dropped so a v3-only client is closed with 1002 "protocol mismatch".
// Advertise a 3–4 range — the gateway negotiates the highest mutually
// supported version, so this works against both old and updated gateways.
const PROTO_MIN = 3;
const PROTO_MAX = 4;
const PING_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 5_000;
const AUTH_FALLBACK_MS = 3_000;

// Per-browser stable identity — sent as client.instanceId on every connect.
// Without this, the gateway computes presenceKey = (device.id ?? instanceId
// ?? connId) and treats every user with the same `client.id` as the same
// device, evicting earlier sessions when a new one arrives. That's why
// "two users can't connect at the same time" and "my socket randomly
// disconnects when someone else opens the app" turn out to be the same
// bug. See openclaw/src/gateway/server/ws-connection/message-handler.ts:1305
// and openclaw/src/gateway/protocol/client-info.ts:45.
function getInstanceId() {
  // localStorage so the id survives page reloads but is unique per
  // browser profile. Different tabs in the same browser share it — that's
  // fine: each tab still gets its own connId server-side, and presenceKey
  // (instanceId) only collapses presence for the *same* user, which is
  // the desired behaviour.
  try {
    let id = localStorage.getItem('oc-instance-id');
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `oc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem('oc-instance-id', id);
    }
    return id;
  } catch {
    // Private mode / storage disabled — fall back to a session-only id.
    return `oc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export class Gateway {
  constructor({ url, getToken, onStatus, onEvent, onSessions, onModels, onChat }) {
    this.url        = url;
    this.getToken   = getToken;
    this.onStatus   = onStatus    || noop;
    this.onEvent    = onEvent     || noop;
    this.onSessions = onSessions  || noop;
    this.onModels   = onModels    || noop;
    this.onChat     = onChat      || noop;

    this.socket    = null;
    this.connecting = false;
    this.authed    = false;
    this.pingTimer = null;
    this.retryTimer = null;
    // True while the user has explicitly disconnected — suppresses the
    // 5s auto-reconnect that _onClose normally schedules. Cleared as soon
    // as connect() is called again.
    this.manuallyClosed = false;
    this.pending   = new Map();   // reqId → { resolve, reject }
  }

  /** Open the socket. Idempotent: existing OPEN/CONNECTING sockets short-circuit. */
  connect() {
    if (this.connecting) return;
    const s = this.socket?.readyState;
    if (s === WebSocket.OPEN || s === WebSocket.CONNECTING) return;

    this.manuallyClosed = false;
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
    this.manuallyClosed = true;
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
    // Skip auto-reconnect when the user has explicitly disconnected.
    if (!this.manuallyClosed) {
      this.retryTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    }
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
          client: {
            id:         'openclaw-control-ui',
            version:    '1.0.0',
            platform:   'web',
            mode:       'ui',
            instanceId: getInstanceId(),
          },
          auth:   { token: this.getToken() },
          // operator.admin is required for `sessions.patch` (model override),
          // `cron.add/update/remove`, and `skills.install/update`. Without it
          // the gateway returns: missing scope: operator.admin.
          scopes: ['operator.read', 'operator.write', 'operator.admin'],
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
      if (msg.ok) {
        resolve(msg.payload);
      } else {
        // OpenClaw puts errors under `msg.error.{code,message}` in v3 protocol;
        // older versions put them under `msg.payload`. Check both, plus
        // include the error code so users can grep for it.
        const err = msg.error ?? msg.payload ?? {};
        const message = err.message ?? err.error ?? msg.message ?? 'Gateway error';
        const code    = err.code ?? msg.code;
        const e = new Error(code ? `${code}: ${message}` : message);
        e.code = code;
        e.payload = err;
        reject(e);
      }
      return;
    }

    // 4. Generic error response (no matching pending request).
    if (msg.type === 'res' && !msg.ok) {
      console.warn('[gateway] error response:', msg.error ?? msg.payload ?? msg);
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

    // 7. Chat-stream events — broadcast to per-session subscribers.
    if (msg.type === 'event' && msg.event === 'chat' && msg.payload) {
      this.onChat(msg.payload);
      return;
    }

    // 7b. Tool-stream events (protocol v4). Tool calls/results do NOT ride
    // inside the `chat` event — they arrive on a separate `agent` /
    // `session.tool` event with `payload.stream === "tool"`, keyed by the
    // same sessionKey. Funnel them through the same per-session fan-out so
    // useChat can attach tool cards to the in-flight message.
    if (msg.type === 'event'
        && (msg.event === 'agent' || msg.event === 'session.tool')
        && msg.payload?.stream === 'tool'
        && msg.payload.sessionKey) {
      this.onChat(msg.payload);
      return;
    }

    // 8. Server events — refresh sessions on any event after auth.
    if (msg.type === 'event') {
      this.onEvent(msg);
      if (this.authed) this.send('sessions.list');
    }
  }
}

function noop() {}
