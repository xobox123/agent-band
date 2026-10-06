import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import type { TaskTarget } from '../domain/task.ts';
import { taskStatuses } from '../domain/task.ts';
export const taskKeySeq = pgTable('task_key_seq', {
  orgId: uuid('org_id').primaryKey(),
  seq: integer('seq').notNull().default(0),
});
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    workDir: text('work_dir').notNull(),
    target: jsonb('target').$type<TaskTarget>().notNull(),
    priority: integer('priority').notNull().default(2),
    rank: doublePrecision('rank').notNull().default(0),
    mode: text('mode', { enum: ['read-only', 'edit', 'full-auto'] }),
    status: text('status', { enum: taskStatuses }).notNull().default('queued'),
    runAt: timestamp('run_at', { withTimezone: true }),
    scheduleId: uuid('schedule_id'),
    attempt: integer('attempt').notNull().default(1),
    maxAttempts: integer('max_attempts').notNull().default(3),
    resumeAt: timestamp('resume_at', { withTimezone: true }),
    workerId: text('worker_id'),
    error: text('error'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tasks_org_key').on(t.orgId, t.key),
    index('tasks_queue').on(t.orgId, t.status, t.priority, t.rank, t.createdAt),
    index('tasks_run_at').on(t.status, t.runAt),
    index('tasks_resume_at').on(t.status, t.resumeAt),
    index('tasks_schedule').on(t.orgId, t.scheduleId),
    check('tasks_priority', sql`${t.priority} between 0 and 3`),
  ],
);
export type Task = typeof tasks.$inferSelect;
