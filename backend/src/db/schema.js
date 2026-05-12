// Postgres schema — single source of truth. Drizzle Kit reads this and
// emits SQL migrations under ./migrations.

import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, timestamp, jsonb, integer, boolean, index,
} from 'drizzle-orm/pg-core';

// ── Users (email/password auth) ──────────────────────────────────────────
// Passwords are stored as bcrypt hashes ($2b$10$…); never log this column.
// `email` is normalised lowercase on write and indexed unique.

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name:         text('name'),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt:  timestamp('last_login_at', { withTimezone: true }),
}, (t) => ({
  emailIdx: index('users_email_idx').on(t.email),
}));

// ── Hierarchy ────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const boardGroups = pgTable('board_groups', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orgIdx: index('board_groups_org_idx').on(t.orgId),
}));

export const boards = pgTable('boards', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  boardGroupId:        uuid('board_group_id').notNull().references(() => boardGroups.id, { onDelete: 'cascade' }),
  name:                text('name').notNull(),
  description:         text('description').default('').notNull(),
  defaultAgentId:      text('default_agent_id'),
  defaultInstructions: text('default_instructions'),

  // Mission-control board policy flags
  boardType:                                 text('board_type').default('goal').notNull(),
  objective:                                 text('objective'),
  successMetrics:                            jsonb('success_metrics'),
  targetDate:                                timestamp('target_date', { withTimezone: true }),
  goalConfirmed:                             boolean('goal_confirmed').default(false).notNull(),
  requireApprovalForDone:                    boolean('require_approval_for_done').default(true).notNull(),
  requireReviewBeforeDone:                   boolean('require_review_before_done').default(false).notNull(),
  commentRequiredForReview:                  boolean('comment_required_for_review').default(false).notNull(),
  blockStatusChangesWithPendingApproval:     boolean('block_status_with_pending_approval').default(false).notNull(),
  onlyLeadCanChangeStatus:                   boolean('only_lead_can_change_status').default(false).notNull(),
  maxAgents:                                 integer('max_agents').default(1).notNull(),

  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  groupIdx: index('boards_group_idx').on(t.boardGroupId),
}));

// ── Virtual agents (UI-only personas; map to a real OpenClaw agent) ─────

export const virtualAgents = pgTable('virtual_agents', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  name:                text('name').notNull(),
  baseAgentId:         text('base_agent_id').notNull(),
  boardId:             uuid('board_id').references(() => boards.id, { onDelete: 'set null' }),
  role:                text('role').default('Generalist').notNull(),
  emoji:               text('emoji').default('⚙️').notNull(),
  communicationStyle:  text('communication_style').default('direct, concise, practical').notNull(),
  heartbeatInterval:   text('heartbeat_interval').default('10m').notNull(),
  instructions:        text('instructions'),
  description:         text('description'),
  isBoardLead:         boolean('is_board_lead').default(false).notNull(),
  status:              text('status').default('active').notNull(),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  boardIdx: index('virtual_agents_board_idx').on(t.boardId),
}));

// ── Tasks ────────────────────────────────────────────────────────────────

// status enum (mission-control parity):
//   inbox        — created, not yet started
//   in_progress  — actively running (assign sets this)
//   review       — finished but needs human approval/review
//   done         — completed and accepted
export const tasks = pgTable('tasks', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  boardId:               uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  title:                 text('title').notNull(),
  description:           text('description'),
  status:                text('status').notNull().default('inbox'),
  priority:              text('priority').notNull().default('medium'),  // low|medium|high|urgent
  assigneeAgentId:       text('assignee_agent_id'),
  assigneeKind:          text('assignee_kind'),                          // 'real' | 'virtual'
  sessionKey:            text('session_key'),
  lastResult:            text('last_result'),
  dueAt:                 timestamp('due_at', { withTimezone: true }),
  inProgressAt:          timestamp('in_progress_at', { withTimezone: true }),
  previousInProgressAt:  timestamp('previous_in_progress_at', { withTimezone: true }),
  autoCreated:           boolean('auto_created').default(false).notNull(),
  autoReason:            text('auto_reason'),
  customFieldValues:     jsonb('custom_field_values'),                    // {field_key: value}
  createdAt:             timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  boardIdx:    index('tasks_board_idx').on(t.boardId),
  statusIdx:   index('tasks_status_idx').on(t.status),
  priorityIdx: index('tasks_priority_idx').on(t.priority),
  sessionIdx:  index('tasks_session_idx').on(t.sessionKey),
}));

// Task dependencies (one task depends on another finishing first)
export const taskDependencies = pgTable('task_dependencies', {
  id:               uuid('id').primaryKey().defaultRandom(),
  taskId:           uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  dependsOnTaskId:  uuid('depends_on_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  taskIdx:   index('task_deps_task_idx').on(t.taskId),
  uniqEdge:  index('task_deps_uniq_idx').on(t.taskId, t.dependsOnTaskId),
}));

export const taskRuns = pgTable('task_runs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  taskId:       uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  runId:        text('run_id'),
  sessionKey:   text('session_key').notNull(),
  startedAt:    timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt:   timestamp('finished_at', { withTimezone: true }),
  stopReason:   text('stop_reason'),
  transcript:   text('transcript'),
}, (t) => ({
  taskIdx: index('task_runs_task_idx').on(t.taskId),
}));

// ── Approvals ────────────────────────────────────────────────────────────

// status: pending | approved | rejected
export const approvals = pgTable('approvals', {
  id:             uuid('id').primaryKey().defaultRandom(),
  boardId:        uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
  taskId:         uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  agentId:        text('agent_id'),
  actionType:     text('action_type').notNull(),
  payload:        jsonb('payload'),
  confidence:     integer('confidence'),
  rubricScores:   jsonb('rubric_scores'),
  leadReasoning:  text('lead_reasoning'),                 // required by API; stored too
  status:         text('status').notNull().default('pending'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt:     timestamp('resolved_at', { withTimezone: true }),
  resolvedBy:     text('resolved_by'),
}, (t) => ({
  statusIdx: index('approvals_status_idx').on(t.status),
  taskIdx:   index('approvals_task_idx').on(t.taskId),
  boardIdx:  index('approvals_board_idx').on(t.boardId),
}));

// Multi-task approval links (one approval can lock multiple tasks).
export const approvalTaskLinks = pgTable('approval_task_links', {
  id:          uuid('id').primaryKey().defaultRandom(),
  approvalId:  uuid('approval_id').notNull().references(() => approvals.id, { onDelete: 'cascade' }),
  taskId:      uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
}, (t) => ({
  approvalIdx: index('approval_links_approval_idx').on(t.approvalId),
  taskIdx:     index('approval_links_task_idx').on(t.taskId),
}));

// Custom field definitions (per-org reusable schema)
// Field types: text|text_long|integer|decimal|boolean|date|date_time|url|json
// ui_visibility: always|if_set|hidden
export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  fieldKey:         text('field_key').notNull(),
  label:            text('label').notNull(),
  fieldType:        text('field_type').notNull().default('text'),
  uiVisibility:     text('ui_visibility').notNull().default('always'),
  validationRegex:  text('validation_regex'),
  description:      text('description'),
  required:         boolean('required').default(false).notNull(),
  defaultValue:     jsonb('default_value'),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orgIdx:    index('cfd_org_idx').on(t.orgId),
  uniqKey:   index('cfd_org_key_idx').on(t.orgId, t.fieldKey),
}));

// ── Task comments ────────────────────────────────────────────────────────

export const taskComments = pgTable('task_comments', {
  id:        uuid('id').primaryKey().defaultRandom(),
  taskId:    uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  author:    text('author').notNull().default('user'),    // 'user' | 'agent' | <name>
  body:      text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  taskIdx: index('task_comments_task_idx').on(t.taskId),
}));

// ── Tags (per-org) ───────────────────────────────────────────────────────

export const tags = pgTable('tags', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  color:     text('color'),                                // optional hex like '#7c3aed'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orgIdx:    index('tags_org_idx').on(t.orgId),
}));

export const taskTags = pgTable('task_tags', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  tagId:  uuid('tag_id').notNull().references(() => tags.id,  { onDelete: 'cascade' }),
}, (t) => ({
  // Composite primary key emulated via unique index
  pk: index('task_tags_pk_idx').on(t.taskId, t.tagId),
}));

// ── Board memory (shared context doc per board) ─────────────────────────

export const boardMemory = pgTable('board_memory', {
  boardId:   uuid('board_id').primaryKey().references(() => boards.id, { onDelete: 'cascade' }),
  content:   text('content').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Webhooks ─────────────────────────────────────────────────────────────

export const webhooks = pgTable('webhooks', {
  id:              uuid('id').primaryKey().defaultRandom(),
  boardId:         uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  url:             text('url').notNull(),
  secret:          text('secret'),
  events:          jsonb('events').notNull().default([]),     // [] = all
  active:          boolean('active').notNull().default(true),
  lastDeliveryAt:  timestamp('last_delivery_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  boardIdx: index('webhooks_board_idx').on(t.boardId),
}));

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  webhookId:    uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  eventType:    text('event_type').notNull(),
  payload:      jsonb('payload'),
  status:       text('status').notNull(),                     // 'pending' | 'sent' | 'failed'
  statusCode:   integer('status_code'),
  response:     text('response'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  webhookIdx:  index('webhook_deliveries_webhook_idx').on(t.webhookId),
  createdIdx:  index('webhook_deliveries_created_idx').on(t.createdAt),
}));

// ── Activity ─────────────────────────────────────────────────────────────

export const activityLog = pgTable('activity_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  type:      text('type').notNull(),
  payload:   jsonb('payload'),
  actorId:   text('actor_id'),       // who triggered it
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index('activity_log_created_at_idx').on(t.createdAt),
}));
