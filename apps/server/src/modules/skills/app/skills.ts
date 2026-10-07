import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx, type Tx } from '../../../platform/tx.ts';
import type { AgentMembership, ModuleDeps } from '../../../ports/index.ts';
import { bundleSize, contentHashOf, packBundle, skillSourceFiles, unpackBundle } from '../domain/bundle.ts';
import {
  columnsToScope,
  resolveAssignments,
  scopeToColumns,
  type AssignmentRow,
  type SkillScope,
} from '../domain/resolve.ts';
import { skillAssignments, skills, skillVersions } from '../infra/schema.ts';

import type {
  SkillVersionDto,
  SkillDto,
  SkillDetailDto,
  SkillAssignmentDto,
  EffectiveSkillDto,
} from '@agent-band/contracts';
export type { SkillVersionDto, SkillDto, SkillDetailDto, SkillAssignmentDto } from '@agent-band/contracts';
export type EffectiveSkill = EffectiveSkillDto;

export interface SkillBundle {
  skillId: string;
  name: string;
  version: number;
  contentHash: string;
  files: Record<string, Uint8Array>;
}

export type BundleInput = { files?: Record<string, string>; zip?: string };
export type SkillSource = 'upload' | 'path' | 'git';

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function validateName(name: string): string {
  if (!NAME.test(name)) {
    throw invalid([{ path: 'name', message: 'name must match [a-z0-9][a-z0-9._-]{0,63}' }]);
  }
  return name;
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

const skillDto = (r: typeof skills.$inferSelect): SkillDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  currentVersion: r.currentVersion,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

const versionCols = {
  skillId: skillVersions.skillId,
  version: skillVersions.version,
  contentHash: skillVersions.contentHash,
  sizeBytes: skillVersions.sizeBytes,
  source: skillVersions.source,
  origin: skillVersions.origin,
  createdBy: skillVersions.createdBy,
  createdAt: skillVersions.createdAt,
};

const versionDto = (r: {
  skillId: string;
  version: number;
  contentHash: string;
  sizeBytes: number;
  source: string;
  origin: string | null;
  createdBy: string;
  createdAt: Date;
}): SkillVersionDto => ({ ...r, createdAt: r.createdAt.toISOString() });

async function insertVersion(
  tx: Tx,
  actor: ActorContext,
  skillId: string,
  version: number,
  input: BundleInput & { source?: SkillSource; origin?: string },
): Promise<{ contentHash: string; sizeBytes: number }> {
  const files = skillSourceFiles(input);
  const contentHash = contentHashOf(files);
  const sizeBytes = bundleSize(files);
  await tx.insert(skillVersions).values({
    skillId,
    version,
    orgId: actor.orgId,
    contentHash,
    bundle: packBundle(files),
    sizeBytes,
    source: input.source ?? 'upload',
    origin: input.origin ?? null,
    createdBy: actor.principalId,
  });
  return { contentHash, sizeBytes };
}

export async function importSkill(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  input: BundleInput & { name: string; description?: string; source?: SkillSource; origin?: string },
): Promise<SkillDetailDto> {
  await deps.authorizer.authorize(db, actor, 'agent.manage', {});
  const name = validateName(input.name);
  skillSourceFiles(input); // fail fast before opening a transaction
  let id: string;
  try {
    id = await withTx(db, async (tx) => {
      const [row] = await tx
        .insert(skills)
        .values({
          orgId: actor.orgId,
          name,
          description: input.description ?? '',
          currentVersion: 1,
          createdBy: actor.principalId,
        })
        .returning();
      if (!row) throw new Error('skill insert returned no row');
      const { contentHash, sizeBytes } = await insertVersion(tx, actor, row.id, 1, input);
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'skill.import',
        targetType: 'skill',
        targetId: row.id,
        data: { name, version: 1, contentHash, sizeBytes, source: input.source ?? 'upload' },
      });
      await publish(tx, 'skill.updated', { orgId: actor.orgId, skillId: row.id, version: 1 });
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('skill_name_taken', `skill "${name}" already exists`);
    throw err;
  }
  return loadSkill(db, actor.orgId, id);
}

export async function newSkillVersion(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  skillId: string,
  input: BundleInput & { description?: string; source?: SkillSource; origin?: string },
): Promise<SkillDetailDto> {
  await deps.authorizer.authorize(db, actor, 'agent.manage', {});
  const newHash = contentHashOf(skillSourceFiles(input));
  await withTx(db, async (tx) => {
    const [cur] = await tx
      .select()
      .from(skills)
      .where(and(eq(skills.id, skillId), eq(skills.orgId, actor.orgId)))
      .for('update');
    if (!cur) throw notFound('skill');
    const [head] = await tx
      .select({ contentHash: skillVersions.contentHash })
      .from(skillVersions)
      .where(
        and(
          eq(skillVersions.skillId, skillId),
          eq(skillVersions.version, cur.currentVersion),
          eq(skillVersions.orgId, actor.orgId),
        ),
      );
    if (head && head.contentHash === newHash) {
      throw conflict('skill_unchanged', 'content is identical to the current version');
    }
    const version = cur.currentVersion + 1;
    const { contentHash, sizeBytes } = await insertVersion(tx, actor, skillId, version, input);
    await tx
      .update(skills)
      .set({ currentVersion: version, description: input.description ?? cur.description })
      .where(and(eq(skills.id, skillId), eq(skills.orgId, actor.orgId)));
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'skill.version.create',
      targetType: 'skill',
      targetId: skillId,
      data: { name: cur.name, version, contentHash, sizeBytes, source: input.source ?? 'upload' },
    });
    await publish(tx, 'skill.updated', { orgId: actor.orgId, skillId, version });
  });
  return loadSkill(db, actor.orgId, skillId);
}

async function loadSkill(db: Db, orgId: string, skillId: string): Promise<SkillDetailDto> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.orgId, orgId)));
  if (!row) throw notFound('skill');
  const vers = await db
    .select(versionCols)
    .from(skillVersions)
    .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.orgId, orgId)))
    .orderBy(asc(skillVersions.version));
  return { ...skillDto(row), versions: vers.map(versionDto) };
}

export async function getSkill(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  skillId: string,
): Promise<SkillDetailDto> {
  await deps.authorizer.authorize(db, actor, 'read', {});
  return loadSkill(db, actor.orgId, skillId);
}

export async function listSkills(db: Db, deps: ModuleDeps, actor: ActorContext): Promise<SkillDto[]> {
  await deps.authorizer.authorize(db, actor, 'read', {});
  const rows = await db.select().from(skills).where(eq(skills.orgId, actor.orgId)).orderBy(asc(skills.name));
  return rows.map(skillDto);
}

function scopeResource(scope: SkillScope): { agentId?: string; agentGroupIds?: string[] } {
  if ('agentId' in scope) return { agentId: scope.agentId };
  if ('agentGroupId' in scope) return { agentGroupIds: [scope.agentGroupId] };
  return {};
}

async function authorizeScope(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  scope: SkillScope,
): Promise<void> {
  const action = 'org' in scope ? 'org.manage' : 'agent.manage';
  await deps.authorizer.authorize(db, actor, action, scopeResource(scope));
}

const assignmentDto = (r: typeof skillAssignments.$inferSelect): SkillAssignmentDto => ({
  id: r.id,
  skillId: r.skillId,
  pinnedVersion: r.pinnedVersion,
  scope: columnsToScope(r.scopeKind, r.scopeId),
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

export async function assignSkill(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  input: { skillId: string; scope: SkillScope; pinnedVersion?: number },
): Promise<SkillAssignmentDto> {
  await authorizeScope(db, deps, actor, input.scope);
  const col = scopeToColumns(input.scope, actor.orgId);
  try {
    return await withTx(db, async (tx) => {
      const [skill] = await tx
        .select()
        .from(skills)
        .where(and(eq(skills.id, input.skillId), eq(skills.orgId, actor.orgId)));
      if (!skill) throw notFound('skill');
      if (input.pinnedVersion !== undefined) {
        const [v] = await tx
          .select({ version: skillVersions.version })
          .from(skillVersions)
          .where(
            and(
              eq(skillVersions.skillId, skill.id),
              eq(skillVersions.version, input.pinnedVersion),
              eq(skillVersions.orgId, actor.orgId),
            ),
          );
        if (!v) throw notFound(`skill version ${input.pinnedVersion}`);
      }
      const [row] = await tx
        .insert(skillAssignments)
        .values({
          orgId: actor.orgId,
          skillId: skill.id,
          pinnedVersion: input.pinnedVersion ?? null,
          scopeKind: col.kind,
          scopeId: col.id,
          createdBy: actor.principalId,
        })
        .returning();
      if (!row) throw new Error('assignment insert returned no row');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'skill.assign',
        targetType: 'skill',
        targetId: skill.id,
        data: { assignmentId: row.id, scope: input.scope, pinnedVersion: input.pinnedVersion ?? null },
      });
      await publish(tx, 'skill.assignment.updated', {
        orgId: actor.orgId,
        skillId: skill.id,
        scope: input.scope,
      });
      return assignmentDto(row);
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw conflict('skill_already_assigned', 'skill is already assigned at this scope');
    throw err;
  }
}

export async function unassignSkill(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(skillAssignments)
    .where(and(eq(skillAssignments.id, assignmentId), eq(skillAssignments.orgId, actor.orgId)));
  if (!row) throw notFound('skill assignment');
  const scope = columnsToScope(row.scopeKind, row.scopeId);
  await authorizeScope(db, deps, actor, scope);
  await withTx(db, async (tx) => {
    const deleted = await tx
      .delete(skillAssignments)
      .where(and(eq(skillAssignments.id, assignmentId), eq(skillAssignments.orgId, actor.orgId)))
      .returning({ id: skillAssignments.id });
    if (deleted.length === 0) throw notFound('skill assignment');
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'skill.unassign',
      targetType: 'skill',
      targetId: row.skillId,
      data: { assignmentId, scope },
    });
    await publish(tx, 'skill.assignment.updated', { orgId: actor.orgId, skillId: row.skillId, scope });
  });
}

export async function listSkillAssignments(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  filter: { skillId?: string; agentGroupId?: string; agentId?: string } = {},
): Promise<SkillAssignmentDto[]> {
  await deps.authorizer.authorize(db, actor, 'read', {});
  const rows = await db
    .select()
    .from(skillAssignments)
    .where(
      and(
        eq(skillAssignments.orgId, actor.orgId),
        filter.skillId ? eq(skillAssignments.skillId, filter.skillId) : undefined,
        filter.agentId
          ? and(eq(skillAssignments.scopeKind, 'agent'), eq(skillAssignments.scopeId, filter.agentId))
          : undefined,
        filter.agentGroupId
          ? and(eq(skillAssignments.scopeKind, 'group'), eq(skillAssignments.scopeId, filter.agentGroupId))
          : undefined,
      ),
    )
    .orderBy(asc(skillAssignments.createdAt));
  return rows.map(assignmentDto);
}

/** Union over org, the agent's groups and the agent; the most specific assignment decides the pin. */
export async function getEffectiveSkills(
  db: Db,
  agentId: string,
  ctx: { orgId: string; membership: AgentMembership },
): Promise<EffectiveSkill[]> {
  const groupIds = await ctx.membership.groupIdsOf(db, agentId);
  const rows = await db
    .select()
    .from(skillAssignments)
    .where(
      and(
        eq(skillAssignments.orgId, ctx.orgId),
        or(
          and(eq(skillAssignments.scopeKind, 'org'), eq(skillAssignments.scopeId, ctx.orgId)),
          and(eq(skillAssignments.scopeKind, 'agent'), eq(skillAssignments.scopeId, agentId)),
          groupIds.length > 0
            ? and(eq(skillAssignments.scopeKind, 'group'), inArray(skillAssignments.scopeId, groupIds))
            : undefined,
        ),
      ),
    )
    .orderBy(skillAssignments.scopeId, skillAssignments.id);
  const resolved = resolveAssignments(
    rows.map((r): AssignmentRow => ({
      skillId: r.skillId,
      pinnedVersion: r.pinnedVersion,
      level: r.scopeKind as AssignmentRow['level'],
    })),
  );
  if (resolved.size === 0) return [];
  const ids = [...resolved.keys()];
  const heads = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, ctx.orgId), inArray(skills.id, ids)));
  const vers = await db
    .select({
      skillId: skillVersions.skillId,
      version: skillVersions.version,
      contentHash: skillVersions.contentHash,
    })
    .from(skillVersions)
    .where(and(eq(skillVersions.orgId, ctx.orgId), inArray(skillVersions.skillId, ids)));
  const out: EffectiveSkill[] = [];
  for (const head of heads) {
    const version = resolved.get(head.id) ?? head.currentVersion;
    const ver = vers.find((v) => v.skillId === head.id && v.version === version);
    if (!ver) throw notFound(`skill version ${head.name}@${version}`);
    const rank: Record<string, number> = { org: 0, group: 1, agent: 2 };
    const origin = rows
      .filter((r) => r.skillId === head.id)
      .sort((a, b) => (rank[b.scopeKind] ?? 0) - (rank[a.scopeKind] ?? 0))[0];
    if (!origin) throw new Error('Resolved skill has no assignment');
    out.push({
      skillId: head.id,
      name: head.name,
      version,
      contentHash: ver.contentHash,
      origin: columnsToScope(origin.scopeKind, origin.scopeId),
      pinnedVersion: origin.pinnedVersion,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns the files of one skill version for the runner; verifies the stored hash. */
export async function loadSkillBundle(
  db: Db,
  skillId: string,
  version: number,
  orgId: string,
): Promise<SkillBundle> {
  const [row] = await db
    .select({ bundle: skillVersions.bundle, contentHash: skillVersions.contentHash, name: skills.name })
    .from(skillVersions)
    .innerJoin(skills, eq(skills.id, skillVersions.skillId))
    .where(
      and(
        eq(skillVersions.skillId, skillId),
        eq(skillVersions.version, version),
        eq(skillVersions.orgId, orgId),
        eq(skills.orgId, orgId),
      ),
    );
  if (!row) throw notFound('skill version');
  const files = unpackBundle(row.bundle);
  if (contentHashOf(files) !== row.contentHash) {
    throw new Error(`skill ${row.name}@${version} bundle does not match its content hash`);
  }
  return {
    skillId,
    name: row.name,
    version,
    contentHash: row.contentHash,
    files: Object.fromEntries(files),
  };
}
