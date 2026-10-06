import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ToolPolicySnapshot } from '../domain/tool-authz.ts';

/** Per-run credentials and the policy snapshot used for runtime tool authorization. */
export const runAuth = pgTable('execution_run_auth', {
  runId: uuid('run_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  workDir: text('work_dir').notNull(),
  tokenHash: text('token_hash').notNull(),
  policy: jsonb('policy').$type<ToolPolicySnapshot>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
