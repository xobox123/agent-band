import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import type { ScheduleTemplate } from '../domain/schedule.ts';

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    cron: text('cron').notNull(),
    timezone: text('timezone'),
    template: jsonb('template').$type<ScheduleTemplate>().notNull(),
    overlap: text('overlap', { enum: ['skip', 'queue'] })
      .notNull()
      .default('skip'),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    lastTaskId: uuid('last_task_id'),
    nextFireAt: timestamp('next_fire_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('schedules_due').on(t.enabled, t.nextFireAt), index('schedules_org').on(t.orgId, t.name)],
);

export type Schedule = typeof schedules.$inferSelect;
