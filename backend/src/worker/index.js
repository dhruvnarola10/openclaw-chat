// BullMQ worker entry — runs in Docker (`leo-worker` service).
// Consumes the `tasks` queue and routes jobs to handlers in ./jobs.

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { GatewayClient } from '../gateway/client.js';
import { env } from '../env.js';
import { runTaskAssign } from './jobs/task-assign.js';
import { runWebhookDelivery } from './jobs/webhook-deliver.js';
import { eq } from 'drizzle-orm';
import { db, tasks } from '../db/index.js';

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

// Single shared gateway connection for the whole worker process.
// We expose `__handlers` (Set) for jobs to register chat-event listeners.
const gateway = new GatewayClient({
  url:   env.gatewayWsUrl,
  token: env.gatewayToken,
  onStatus: (s) => console.log('[worker:gw]', s),
  onChat: (payload) => {
    for (const h of gateway.__handlers) {
      try { h(payload); } catch (e) { console.warn('[worker:gw] handler threw', e); }
    }
  },
});
gateway.__handlers = new Set();
gateway.connect();

const worker = new Worker('tasks', async (job) => {
  console.log('[worker] processing', job.name, job.data?.taskId);
  if (job.name === 'assign') {
    await runTaskAssign({ taskId: job.data.taskId, gateway });
    return;
  }
  if (job.name === 'cancel') {
    const taskId = job.data.taskId;
    const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (t?.sessionKey) {
      try { await gateway.request('chat.abort', { sessionKey: t.sessionKey }); }
      catch (e) { console.warn('[worker] chat.abort failed:', e.message); }
    }
    await db.update(tasks)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    return;
  }
  console.warn('[worker] unknown job', job.name);
}, {
  connection,
  concurrency: 4,
});

worker.on('completed', (job) => console.log('[worker] done', job.id, job.name));
worker.on('failed',    (job, err) => console.error('[worker] failed', job?.id, err?.message));

const webhookWorker = new Worker('webhooks', async (job) => {
  console.log('[worker:webhook] processing', job.name, job.data?.webhookId);
  if (job.name === 'deliver') {
    await runWebhookDelivery(job.data);
    return;
  }
}, { connection, concurrency: 4 });

webhookWorker.on('completed', (job) => console.log('[worker:webhook] done', job.id));
webhookWorker.on('failed',    (job, err) => console.error('[worker:webhook] failed', job?.id, err?.message));

const shutdown = async (sig) => {
  console.log(`[worker] received ${sig}, draining…`);
  await worker.close();
  await webhookWorker.close();
  gateway.close();
  await connection.quit();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

console.log('[worker] ready, waiting for jobs');
