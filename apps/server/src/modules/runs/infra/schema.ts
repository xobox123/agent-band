import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  bigserial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { NormalizedEvent } from '@agent-band/contracts';
import { runStatuses, type SkillSnapshot } from '../domain/run.ts';
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    taskId: uuid('task_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    accountId: uuid('account_id').notNull(),
    workerId: text('worker_id').notNull(),
    effectivePolicy: jsonb('effective_policy').$type<Record<string, unknown>>().notNull(),
    skills: jsonb('skills').$type<SkillSnapshot[]>().notNull(),
    status: text('status', { enum: runStatuses }).notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    exitCode: integer('exit_code'),
    inputTokens: doublePrecision('input_tokens').notNull().default(0),
    outputTokens: doublePrecision('output_tokens').notNull().default(0),
    cachedTokens: doublePrecision('cached_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd'),
    rateLimitResetsAt: timestamp('rate_limit_resets_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    index('runs_org_account_status').on(t.orgId, t.accountId, t.status),
    uniqueIndex('runs_org_task').on(t.orgId, t.taskId),
  ],
);
export const runEvents = pgTable(
  'run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id').notNull(),
    runId: uuid('run_id').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').$type<NormalizedEvent['kind']>().notNull(),
    payload: jsonb('payload').$type<NormalizedEvent>().notNull(),
  },
  (t) => [index('run_events_org_run_id').on(t.orgId, t.runId, t.id)],
);
export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
