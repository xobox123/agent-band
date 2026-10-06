import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable(
  'audit_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id').notNull(),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' }).notNull(),
    actorId: uuid('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    data: jsonb('data').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('audit_events_org_seq_idx').on(t.orgId, t.seq),
    index('audit_events_org_target_idx').on(t.orgId, t.targetType, t.targetId),
  ],
);
