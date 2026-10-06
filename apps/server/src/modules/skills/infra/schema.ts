import {
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => new Uint8Array(value),
});

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    currentVersion: integer('current_version').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('skills_org_name_uq').on(t.orgId, t.name)],
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    version: integer('version').notNull(),
    orgId: uuid('org_id').notNull(),
    contentHash: text('content_hash').notNull(),
    bundle: bytea('bundle').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    source: text('source').notNull().default('upload'),
    origin: text('origin'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.version] })],
);

export const skillAssignments = pgTable(
  'skill_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    pinnedVersion: integer('pinned_version'),
    scopeKind: text('scope_kind').notNull(),
    // org scope stores the org id here so the unique key needs no nulls
    scopeId: uuid('scope_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('skill_assignments_scope_uq').on(t.skillId, t.scopeKind, t.scopeId),
    index('skill_assignments_org_scope_idx').on(t.orgId, t.scopeKind, t.scopeId),
  ],
);
