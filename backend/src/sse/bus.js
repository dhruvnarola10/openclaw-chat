// In-process SSE pub/sub. Routes accept one HTTP connection per topic and
// flush each event as `event: <type>\ndata: <json>\n\n`. The worker pushes
// updates via Redis Pub/Sub which we relay to local subscribers.

import { Redis } from 'ioredis';
import { env } from '../env.js';

const REDIS_CHANNEL_PREFIX = 'leo:sse:';

const subs = new Map();             // topic → Set<res>
const sub  = new Redis(env.redisUrl);
const pub  = new Redis(env.redisUrl);

sub.psubscribe(`${REDIS_CHANNEL_PREFIX}*`).catch((e) => {
  console.warn('[sse] redis psubscribe failed:', e.message);
});

sub.on('pmessage', (_pattern, channel, message) => {
  const topic = channel.slice(REDIS_CHANNEL_PREFIX.length);
  const set   = subs.get(topic);
  if (!set || !set.size) return;
  for (const res of set) {
    try { res.write(message); } catch { /* client gone */ }
  }
});

export function attachSse(req, res, topic) {
  res.set({
    'Content-Type':       'text/event-stream',
    'Cache-Control':      'no-cache, no-transform',
    'Connection':         'keep-alive',
    'X-Accel-Buffering':  'no',          // tell nginx not to buffer
  });
  res.flushHeaders?.();
  res.write(`: connected to ${topic}\n\n`);

  let set = subs.get(topic);
  if (!set) { set = new Set(); subs.set(topic, set); }
  set.add(res);

  const ping = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { /* ignore */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (!set.size) subs.delete(topic);
  });
}

/** Publish from anywhere (including this process's own routes). */
export function publishSse(topic, type, data) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  pub.publish(`${REDIS_CHANNEL_PREFIX}${topic}`, frame).catch(() => {});
}
