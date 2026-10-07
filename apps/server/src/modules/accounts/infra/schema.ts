import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    type: text('type').notNull(),
    providerConfig: jsonb('provider_config').notNull().default({}),
    configDir: text('config_dir'),
    secretEnc: text('secret_enc'),
    secretUpdatedAt: timestamp('secret_updated_at', { withTimezone: true }),
    providerIdentity: text('provider_identity'),
    labels: text('labels').array().notNull().default([]),
    paused: boolean('paused').notNull().default(false),
    limits: jsonb('limits').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_org_idx').on(t.orgId)],
);
