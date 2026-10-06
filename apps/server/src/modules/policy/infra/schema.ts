import { integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    currentVersion: integer('current_version').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('policies_org_name_uq').on(t.orgId, t.name)],
);

export const policyVersions = pgTable(
  'policy_versions',
  {
    policyId: uuid('policy_id')
      .notNull()
      .references(() => policies.id),
    version: integer('version').notNull(),
    orgId: uuid('org_id').notNull(),
    rules: jsonb('rules').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.version] })],
);
