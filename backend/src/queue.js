// BullMQ producer side. The worker (src/worker/index.js) has the consumer.

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env.js';

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

export const taskQueue    = new Queue('tasks',    { connection });
export const webhookQueue = new Queue('webhooks', { connection });

export async function enqueueTaskAssign(taskId, opts = {}) {
  return taskQueue.add('assign', { taskId, ...opts }, {
    removeOnComplete: 500,
    removeOnFail:     500,
    attempts:         1,
  });
}

export async function enqueueTaskCancel(taskId) {
  return taskQueue.add('cancel', { taskId }, {
    removeOnComplete: 500,
    removeOnFail:     500,
  });
}

export async function enqueueWebhookDelivery({ webhookId, eventType, payload }) {
  return webhookQueue.add('deliver', { webhookId, eventType, payload }, {
    removeOnComplete: 500,
    removeOnFail:     500,
    attempts:         3,
    backoff:          { type: 'exponential', delay: 2000 },
  });
}
