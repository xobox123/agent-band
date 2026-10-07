import { mkdir } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx } from '../../../platform/tx.ts';
import type { DbOrTx, OrgSettings } from '../../../ports/index.ts';
import { appendAudit } from '../../audit/index.ts';
import { organizations } from '../infra/schema.ts';
import { authorize } from './authorize.ts';

export interface OrganizationDto {
  id: string;
  name: string;
  taskKeyPrefix: string;
  timezone: string;
  policyId: string | null;
  paused: boolean;
  workspaceRoot: string;
  createdAt: string;
}

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    taskKeyPrefix: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/)
      .optional(),
    timezone: z.string().refine(isTimezone, 'unknown IANA timezone').optional(),
    workspaceRoot: z
      .string()
      .startsWith('/')
      .max(4096)
      .refine((p) => !p.split('/').includes('..'), 'must not contain ".."')
      .optional(),
  })
  .strict();

const policySchema = z.object({ policyId: z.uuid().nullable() });
const pauseSchema = z.object({ paused: z.boolean() }).strict();

function toDto(r: typeof organizations.$inferSelect): OrganizationDto {
  return {
    id: r.id,
    name: r.name,
    taskKeyPrefix: r.taskKeyPrefix,
    timezone: r.timezone,
    policyId: r.policyId,
    paused: r.paused,
    workspaceRoot: r.workspaceRoot ?? '',
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getOrganization(db: DbOrTx, orgId: string): Promise<OrganizationDto> {
  const rows = await (db as Db).select().from(organizations).where(eq(organizations.id, orgId));
  const row = rows[0];
  if (!row) throw notFound('organization');
  return toDto(row);
}

export const orgSettings: OrgSettings = {
  async get(db, orgId) {
    const o = await getOrganization(db, orgId);
    return {
      taskKeyPrefix: o.taskKeyPrefix,
      timezone: o.timezone,
      paused: o.paused,
      workspaceRoot: o.workspaceRoot,
    };
  },
};

export async function updateOrganization(
  db: Db,
  actor: ActorContext,
  input: unknown,
): Promise<OrganizationDto> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues);
  await authorize(db, actor, 'org.manage', {});
  if (parsed.data.workspaceRoot) await mkdir(parsed.data.workspaceRoot, { recursive: true, mode: 0o700 });
  return withTx(db, async (tx) => {
    const rows = await tx
      .update(organizations)
      .set(parsed.data)
      .where(eq(organizations.id, actor.orgId))
      .returning();
    const row = rows[0];
    if (!row) throw notFound('organization');
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'org.update',
      targetType: 'organization',
      targetId: row.id,
      data: parsed.data,
    });
    await publish(tx, 'org.changed', {
      orgId: row.id,
      entity: 'organization',
      id: row.id,
      change: 'updated',
    });
    return toDto(row);
  });
}

export async function setOrgPolicy(db: Db, actor: ActorContext, input: unknown): Promise<OrganizationDto> {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues);
  await authorize(db, actor, 'agent.manage', {});
  return withTx(db, async (tx) => {
    const rows = await tx
      .update(organizations)
      .set({ policyId: parsed.data.policyId })
      .where(eq(organizations.id, actor.orgId))
      .returning();
    const row = rows[0];
    if (!row) throw notFound('organization');
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'org.policy.set',
      targetType: 'organization',
      targetId: row.id,
      data: { policyId: parsed.data.policyId },
    });
    await publish(tx, 'org.changed', { orgId: row.id, entity: 'organization', id: row.id, change: 'policy' });
    return toDto(row);
  });
}

export async function setOrgPaused(db: Db, actor: ActorContext, input: unknown): Promise<OrganizationDto> {
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues);
  await authorize(db, actor, 'org.manage', {});
  return withTx(db, async (tx) => {
    const rows = await tx
      .update(organizations)
      .set({ paused: parsed.data.paused })
      .where(eq(organizations.id, actor.orgId))
      .returning();
    const row = rows[0];
    if (!row) throw notFound('organization');
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: parsed.data.paused ? 'org.pause' : 'org.resume',
      targetType: 'organization',
      targetId: row.id,
    });
    await publish(tx, 'org.changed', { orgId: row.id, entity: 'organization', id: row.id, change: 'paused' });
    return toDto(row);
  });
}
