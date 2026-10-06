import {
  pgTable,
  uuid,
  timestamp,
  text,
  doublePrecision,
  bigserial,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
export const usageSnapshots = pgTable(
  'usage_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id').notNull(),
    accountId: uuid('account_id').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    window: text('window', { enum: ['5h', 'weekly'] }).notNull(),
    usedPercent: doublePrecision('used_percent').notNull(),
    resetsAt: timestamp('resets_at', { withTimezone: true }),
  },
  (t) => [index('usage_snapshots_account').on(t.orgId, t.accountId, t.window, t.id)],
);
export const accountBlocks = pgTable(
  'usage_account_blocks',
  {
    orgId: uuid('org_id').notNull(),
    accountId: uuid('account_id').notNull(),
    until: timestamp('until', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.accountId] })],
);
