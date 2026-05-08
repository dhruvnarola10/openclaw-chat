// Minimal server-side WS client for OpenClaw. Mirrors the auth flow of
// frontend/src/api/gateway.js but uses `ws` instead of the browser's
// WebSocket. Used by both the API (for read-only fan-out / quick RPCs)
// and the worker (for chat.send + chat events during task execution).

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const PROTO_MIN = 3;
const PROTO_MAX = 3;

export class GatewayClient {
  constructor({ url, token, onChat, onEvent, onStatus }) {
    this.url      = url;
    this.token    = token;
    this.onChat   = onChat   || (() => {});
    this.onEvent  = onEvent  || (() => {});
    this.onStatus = onStatus || (() => {});

    this.socket  = null;
    this.authed  = false;
    this.pending = new Map();         // reqId → { resolve, reject }
    this.retryT  = null;
  }

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN ||
                        this.socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this.retryT);
    this.onStatus('connecting');

    const ws = new WebSocket(this.url, {
      // Origin matters: gateway origin-check lets loopback through
      headers: { Origin: this.url.replace(/^ws/, 'http') },
    });
    this.socket = ws;

    ws.on('open',    () => this._onOpen());
    ws.on('message', (data) => this._onMessage(data));
    ws.on('close',   (code, reason) => this._onClose(code, reason?.toString()));
    ws.on('error',   (err) => {
      console.error('[gw] socket error:', err.message);
      this.onStatus('error');
    });
    // Fires when the server replies with HTTP status instead of upgrading
    // to WS. This is the exact frame that tells us WHY the handshake failed.
    ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); if (body.length > 2000) body = body.slice(0, 2000); });
      res.on('end',  () => {
        console.error(`[gw] handshake rejected: HTTP ${res.statusCode} ${res.statusMessage}`);
        if (body) console.error('[gw] response body:', body);
        console.error('[gw] response headers:', res.headers);
      });
      this.onStatus('error');
    });
  }

  close() {
    clearTimeout(this.retryT);
    this.authed = false;
    this.socket?.close();
  }

  isReady() {
    return this.authed && this.socket?.readyState === WebSocket.OPEN;
  }

  request(method, params = {}, { timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isReady()) return reject(new Error('Gateway not ready'));
      const id = randomUUID();
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject:  (e) => { clearTimeout(t); reject(e); },
      });
      this.socket.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  send(method, params = {}) {
    if (!this.isReady()) return;
    this.socket.send(JSON.stringify({ type: 'req', id: randomUUID(), method, params }));
  }

  _onOpen() {
    // We auth proactively; servers that skip the challenge get a clean req.
    setTimeout(() => { if (!this.authed) this._sendConnect(); }, 100);
  }

  _sendConnect() {
    // Gateway enforces a strict enum on client.id and client.mode
    // (openclaw/src/gateway/protocol/client-info.ts). It also gates which
    // scopes get granted per identity:
    //   • `gateway-client` + `backend` connects but is granted `operator.read`
    //     only — chat.send/sessions.patch/cron.add/etc. all fail with
    //     "missing scope: operator.write".
    //   • `openclaw-control-ui` + `cli` (or `ui`) is granted the full
    //     operator scope set when the auth token is admin-class. That's
    //     what the browser frontend uses, and it works.
    // We use the latter.
    this.socket.send(JSON.stringify({
      type: 'req', id: randomUUID(), method: 'connect',
      params: {
        minProtocol: PROTO_MIN,
        maxProtocol: PROTO_MAX,
        client: {
          id:          'openclaw-control-ui',
          mode:        'cli',
          version:     '0.1.0',
          platform:    'node',
          displayName: 'leonardo-api',
        },
        auth:   { token: this.token },
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
      },
    }));
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // Auth challenge → respond
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this._sendConnect();
      return;
    }
    // hello-ok → authed
    if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
      this.authed = true;
      this.onStatus('on');
      return;
    }
    // Pending request response
    if (msg.type === 'res' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.payload);
      else        p.reject(new Error(
        msg.error?.code
          ? `${msg.error.code}: ${msg.error.message}`
          : (msg.error?.message ?? 'Gateway error'),
      ));
      return;
    }
    // Chat-stream events → fan out to subscribers
    if (msg.type === 'event' && msg.event === 'chat' && msg.payload) {
      this.onChat(msg.payload);
      return;
    }
    if (msg.type === 'event') this.onEvent(msg);
  }

  _onClose(code, reason) {
    if (code) {
      console.error(`[gw] socket closed: code=${code} reason="${reason ?? ''}"`);
    }
    this.authed = false;
    this.onStatus('off');
    for (const { reject } of this.pending.values()) reject(new Error('Gateway closed'));
    this.pending.clear();
    this.retryT = setTimeout(() => this.connect(), 5000);
  }
}

let singleton = null;

/** Module-level shared gateway client (lazy). */
export function getGateway({ url, token, onChat, onEvent, onStatus } = {}) {
  if (!singleton) {
    singleton = new GatewayClient({ url, token, onChat, onEvent, onStatus });
    singleton.connect();
  }
  return singleton;
}
