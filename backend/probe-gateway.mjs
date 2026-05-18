// Standalone gateway connect probe. Sends the EXACT connect params our
// backend uses and prints the raw gateway response — so a post-update
// connect failure names itself instead of us guessing.
//
// Run on the server:  cd backend && node probe-gateway.mjs
// Reads GATEWAY_WS_URL + GATEWAY_TOKEN from backend/.env.

import 'dotenv/config';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const URL   = process.env.GATEWAY_WS_URL || 'ws://127.0.0.1:18789';
const TOKEN = process.env.GATEWAY_TOKEN  || '';

console.log('── Gateway connect probe ──────────────────────────────────');
console.log('URL  :', URL);
console.log('Token:', TOKEN ? `${TOKEN.slice(0, 6)}…(${TOKEN.length} chars)` : '(MISSING)');
console.log('');

if (!TOKEN) { console.error('GATEWAY_TOKEN missing in backend/.env'); process.exit(1); }

const ws = new WebSocket(URL, { headers: { Origin: URL.replace(/^ws/, 'http') } });
let settled = false;
const done = (code) => { if (!settled) { settled = true; try { ws.close(); } catch {} process.exit(code); } };

const timer = setTimeout(() => {
  console.error('❌ TIMEOUT — no connect response in 8s. Gateway up but silent, or wrong port.');
  done(1);
}, 8000);

ws.on('open', () => {
  console.log('✅ TCP/WS upgrade OK — sending connect…\n');
  ws.send(JSON.stringify({
    type: 'req', id: randomUUID(), method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui', mode: 'cli', version: '0.1.0',
        platform: 'node', displayName: 'probe',
      },
      auth:   { token: TOKEN },
      scopes: ['operator.read', 'operator.write', 'operator.admin'],
    },
  }));
});

ws.on('message', (raw) => {
  let msg; try { msg = JSON.parse(raw.toString()); } catch { console.log('non-JSON:', raw.toString().slice(0, 300)); return; }

  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    console.log('↪ got connect.challenge — re-sending connect (expected on some versions)');
    return;
  }
  if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
    clearTimeout(timer);
    console.log('✅ CONNECT OK — gateway accepted our params.');
    console.log('   hello-ok payload keys:', Object.keys(msg.payload).join(', '));
    console.log('   → The connect contract is fine. The problem is elsewhere');
    console.log('     (nginx /ws proxy, browser origin, or APP_TOKEN, not gateway).');
    done(0);
  }
  if (msg.type === 'res' && !msg.ok) {
    clearTimeout(timer);
    console.log('❌ CONNECT REJECTED by the gateway:');
    console.log('   code   :', msg.error?.code ?? '(none)');
    console.log('   message:', msg.error?.message ?? '(none)');
    console.log('   raw    :', JSON.stringify(msg.error));
    console.log('');
    console.log('   → This message names exactly what the gateway update changed.');
    done(2);
  }
});

ws.on('unexpected-response', (_req, res) => {
  clearTimeout(timer);
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => {
    console.log(`❌ HANDSHAKE REJECTED before WS upgrade: HTTP ${res.statusCode} ${res.statusMessage}`);
    console.log('   headers:', JSON.stringify(res.headers));
    if (body) console.log('   body   :', body.slice(0, 500));
    console.log('');
    console.log('   401 → token  · 403 → origin/client  · 426 → protocol  · 404 → wrong path');
    done(2);
  });
});

ws.on('error', (e) => {
  clearTimeout(timer);
  console.error('❌ SOCKET ERROR:', e.message);
  if (e.message.includes('ECONNREFUSED')) {
    console.error('   → Gateway not listening at', URL, '— start it / check the port.');
  }
  done(1);
});

ws.on('close', (code, reason) => {
  if (!settled) {
    clearTimeout(timer);
    console.error(`❌ Closed before connect resolved: code=${code} reason="${reason}"`);
    done(1);
  }
});
