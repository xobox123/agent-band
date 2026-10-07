import {
  boolean,
  jsonb,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    avatar: jsonb('avatar').$type<import('@agent-band/contracts').AgentAvatar>(),
    accountId: uuid('account_id').notNull(),
    model: text('model'),
    role: text('role').notNull(),
    persona: text('persona'),
    systemPrompt: text('system_prompt'),
    labels: text('labels').array().notNull().default([]),
    policyId: uuid('policy_id'),
    enabled: boolean('enabled').notNull().default(true),
    paused: boolean('paused').notNull().default(false),
    gitName: text('git_name').notNull(),
    gitEmail: text('git_email').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [unique('agents_org_slug_uq').on(t.orgId, t.slug), index('agents_account_idx').on(t.accountId)],
);

export const agentGroups = pgTable(
  'agent_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    labels: text('labels').array().notNull().default([]),
    policyId: uuid('policy_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('agent_groups_org_name_uq').on(t.orgId, t.name)],
);

export const agentGroupMembers = pgTable(
  'agent_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => agentGroups.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    orgId: uuid('org_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.agentId] }),
    index('agent_group_members_agent_idx').on(t.agentId),
  ],
);
