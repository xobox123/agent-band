import { bigserial, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const outboxEvents = pgTable('outbox_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
});
