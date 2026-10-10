import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    repoPath: text('repo_path').notNull(),
    defaultBranch: text('default_branch').notNull(),
    worktreesRoot: text('worktrees_root').notNull(),
    checks: jsonb('checks').$type<string[]>().notNull().default([]),
    keepWorktrees: boolean('keep_worktrees').notNull().default(false),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('projects_org_slug').on(t.orgId, t.slug), index('projects_org').on(t.orgId, t.name)],
);

export type Project = typeof projects.$inferSelect;
