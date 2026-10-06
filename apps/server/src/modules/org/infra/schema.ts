import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  taskKeyPrefix: text('task_key_prefix').notNull().default('AB'),
  timezone: text('timezone')
    .notNull()
    .$defaultFn(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  policyId: uuid('policy_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind', { enum: ['user', 'agent', 'system'] }).notNull(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    avatar: text('avatar'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('principals_org_handle_idx').on(t.orgId, t.handle)],
);

export const users = pgTable('users', {
  principalId: uuid('principal_id')
    .primaryKey()
    .references(() => principals.id),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  email: text('email'),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
});

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('teams_org_name_idx').on(t.orgId, t.name)],
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.principalId),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const roleBindings = pgTable(
  'role_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    subjectType: text('subject_type', { enum: ['user', 'team'] }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'operator', 'viewer'] }).notNull(),
    scopeType: text('scope_type', { enum: ['org', 'agentGroup', 'agent'] }).notNull(),
    scopeId: uuid('scope_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('role_bindings_org_subject_idx').on(t.orgId, t.subjectType, t.subjectId),
    check(
      'role_bindings_scope_check',
      sql`(${t.scopeType} = 'org' and ${t.scopeId} is null) or (${t.scopeType} <> 'org' and ${t.scopeId} is not null)`,
    ),
  ],
);
