// task-assign — the central job. Drives a task through the gateway.
//
// 1. Load task + (if virtual agent) its instructions
// 2. Generate / reuse sessionKey
// 3. (Virtual) call sessions.patch with `instructions`
// 4. Subscribe to chat events for that session
// 5. Call chat.send with the task description
// 6. Stream deltas → publish SSE updates + persist transcript
// 7. On final → update task.status=done, lastResult, transcript
// 8. On error/aborted → blocked

import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  db, tasks, taskRuns, virtualAgents, activityLog, webhooks, boards,
  approvals, approvalTaskLinks,
} from '../../db/index.js';
import { publishSse } from '../../sse/bus.js';
import { enqueueWebhookDelivery } from '../../queue.js';

async function fireBoardWebhook(boardId, eventType, payload) {
  if (!boardId) return;
  const hooks = await db.select().from(webhooks).where(eq(webhooks.boardId, boardId));
  for (const h of hooks) {
    if (!h.active) continue;
    const events = Array.isArray(h.events) ? h.events : [];
    if (events.length && !events.includes(eventType) && !events.includes('*')) continue;
    await enqueueWebhookDelivery({ webhookId: h.id, eventType, payload });
  }
}

export async function runTaskAssign({ taskId, gateway }) {
  if (!gateway.isReady()) throw new Error('Gateway not ready');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new Error(`task ${taskId} not found`);
  if (!task.assigneeAgentId) throw new Error(`task ${taskId} has no assignee`);

  // Resolve virtual agent → real base + instructions
  let baseAgentId   = task.assigneeAgentId;
  let extraInstructions = null;
  if (task.assigneeKind === 'virtual') {
    const [va] = await db.select().from(virtualAgents).where(eq(virtualAgents.id, task.assigneeAgentId));
    if (!va) throw new Error(`virtual agent ${task.assigneeAgentId} not found`);
    baseAgentId       = va.baseAgentId;
    extraInstructions = va.instructions;
  }

  const sessionKey = task.sessionKey
    || `agent:${baseAgentId}:web:task-${task.id.slice(0, 8)}`;

  // (Virtual) — set instructions on the session via sessions.patch
  if (extraInstructions) {
    try {
      await gateway.request('sessions.patch', {
        key: sessionKey,
        // newer schemas accept `instructions`; older accept `label`. We
        // try `instructions` and ignore failure — task still runs without.
        instructions: extraInstructions,
      });
    } catch (e) {
      console.warn('[worker] sessions.patch failed (continuing):', e.message);
    }
  }

  // Persist sessionKey on the task so subsequent assigns reuse it.
  await db.update(tasks).set({ sessionKey, updatedAt: new Date() }).where(eq(tasks.id, taskId));

  // Insert a run row
  const [run] = await db.insert(taskRuns).values({
    taskId, sessionKey, transcript: '',
  }).returning();

  // Subscribe to chat events for THIS session, locked to first runId
  let chatRunId = null;
  let buffer    = '';
  let resolved  = false;
  let resolveDone, rejectDone;
  const done = new Promise((r, j) => { resolveDone = r; rejectDone = j; });

  const handler = (payload) => {
    if (payload.sessionKey !== sessionKey) return;
    if (chatRunId == null) chatRunId = payload.runId;
    if (payload.runId !== chatRunId) return;

    const text = payload.message?.content?.[0]?.text ?? '';

    if (payload.state === 'delta') {
      buffer = text;
      publishSse(`task:${taskId}`, 'delta', { taskId, runId: run.id, text });
    } else if (payload.state === 'final') {
      buffer = text || buffer;
      resolved = true;
      resolveDone({ stopReason: payload.stopReason ?? 'completed' });
    } else if (payload.state === 'aborted') {
      resolved = true;
      resolveDone({ stopReason: 'aborted' });
    } else if (payload.state === 'error') {
      resolved = true;
      rejectDone(new Error(payload.errorMessage || 'gateway chat error'));
    }
  };

  // Wire up — gateway.onChat in worker/index.js fans events to handlers
  gateway.__handlers.add(handler);

  // Final-status mapping uses the board's policy:
  //   requireReviewBeforeDone | requireApprovalForDone → 'review'
  //   else → 'done'
  // Errors → 'inbox' so the user can re-trigger
  let outcome = 'done';
  let errMsg  = null;
  const [boardCfg] = await db.select().from(boards).where(eq(boards.id, task.boardId));
  try {
    publishSse(`task:${taskId}`, 'status', { taskId, status: 'running' });
    await gateway.request('chat.send', {
      sessionKey,
      message: buildMessage(task, extraInstructions),
      idempotencyKey: randomUUID(),
      deliver: false,
    });

    // Wait up to 5 minutes for a final/aborted/error event
    const result = await withTimeout(done, 5 * 60_000);
    if (result.stopReason === 'aborted') {
      outcome = 'inbox';                    // reset so user can re-run
    } else if (boardCfg?.requireReviewBeforeDone || boardCfg?.requireApprovalForDone) {
      outcome = 'review';
    } else {
      outcome = 'done';
    }
  } catch (e) {
    outcome = 'inbox';                       // reset on error so user can retry
    errMsg  = e.message;
    console.warn('[worker] task', taskId, 'failed:', e.message);
  } finally {
    gateway.__handlers.delete(handler);
  }

  // Persist final state
  await db.update(taskRuns).set({
    finishedAt: new Date(),
    runId:      chatRunId,
    transcript: buffer,
    stopReason: errMsg || (outcome === 'cancelled' ? 'aborted' : 'completed'),
  }).where(eq(taskRuns.id, run.id));

  await db.update(tasks).set({
    status:     outcome,
    lastResult: buffer.slice(0, 50_000),
    updatedAt:  new Date(),
  }).where(eq(tasks.id, taskId));

  await db.insert(activityLog).values({
    type:    `task.${outcome}`,
    payload: { taskId, runId: run.id, error: errMsg ?? undefined },
  });

  // When a task lands in `review`, auto-create a pending approval so it
  // shows up in the Approvals page without the reviewer having to add it
  // manually. The approval references this run's transcript snippet so the
  // reviewer can quickly judge the output. Skipped for `done`/`inbox`.
  if (outcome === 'review') {
    const reasoning = `Task "${task.title}" finished and is awaiting review.`;
    const [approvalRow] = await db.insert(approvals).values({
      boardId:       task.boardId,
      taskId:        taskId,
      agentId:       task.assigneeAgentId,
      actionType:    'task.complete',
      payload:       { reason: reasoning, runId: run.id, transcriptPreview: buffer.slice(0, 500) },
      leadReasoning: reasoning,
      status:        'pending',
    }).returning();
    await db.insert(approvalTaskLinks).values({
      approvalId: approvalRow.id,
      taskId:     taskId,
    });
    await db.insert(activityLog).values({
      type:    'approval.created',
      payload: { id: approvalRow.id, taskIds: [taskId], agentId: task.assigneeAgentId, actionType: 'task.complete', autoCreated: true },
    });
    publishSse('approvals', 'approval', { kind: 'created', approval: approvalRow, taskIds: [taskId] });
  }

  publishSse(`task:${taskId}`, 'status', {
    taskId, status: outcome, error: errMsg ?? undefined, transcript: buffer,
  });

  // Fire webhooks for the board this task belongs to
  await fireBoardWebhook(task.boardId, `task.${outcome}`, {
    taskId, title: task.title, status: outcome, transcript: buffer.slice(0, 2000),
  });
}

function buildMessage(task, instructions) {
  const parts = [];
  if (instructions) parts.push(`<system-instructions>\n${instructions}\n</system-instructions>\n`);
  parts.push(`Task: ${task.title}`);
  if (task.description) parts.push(`\n${task.description}`);
  if (task.dueAt)       parts.push(`\nDue: ${new Date(task.dueAt).toISOString()}`);
  return parts.join('\n');
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`worker timeout after ${ms}ms`)), ms)),
  ]);
}
