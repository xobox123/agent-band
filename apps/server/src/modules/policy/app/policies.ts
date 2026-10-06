import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx } from '../../../platform/tx.ts';
import type { ModuleDeps, PolicyBindings } from '../../../ports/index.ts';
import { mergePolicies, PolicyRules, type EffectivePolicy } from '../domain/rules.ts';
import { policies, policyVersions } from '../infra/schema.ts';

export interface PolicyDto {
  id: string;
  name: string;
  description: string;
  currentVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyVersionDto {
  policyId: string;
  version: number;
  rules: PolicyRules;
  createdBy: string;
  createdAt: string;
}

export interface PolicyDetailDto extends PolicyDto {
  rules: PolicyRules;
  versions: PolicyVersionDto[];
}

function parseRules(raw: unknown): PolicyRules {
  const r = PolicyRules.safeParse(raw);
  if (!r.success) throw invalid(r.error.issues);
  return r.data;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function normalizeName(name: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 100)
    throw invalid([{ path: 'name', message: 'name must be 1..100 characters' }]);
  return n;
}

function toDto(r: typeof policies.$inferSelect): PolicyDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    currentVersion: r.currentVersion,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toVersionDto(r: typeof policyVersions.$inferSelect): PolicyVersionDto {
  return {
    policyId: r.policyId,
    version: r.version,
    rules: parseRules(r.rules),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

export async function createPolicy(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  input: { name: string; description?: string; rules: unknown },
): Promise<PolicyDetailDto> {
  await deps.authorizer.authorize(db, actor, 'agent.manage', {});
  const name = normalizeName(input.name);
  const rules = parseRules(input.rules);
  try {
    return await withTx(db, async (tx) => {
      const [row] = await tx
        .insert(policies)
        .values({
          orgId: actor.orgId,
          name,
          description: input.description ?? '',
          currentVersion: 1,
          createdBy: actor.principalId,
        })
        .returning();
      if (!row) throw new Error('policy insert returned no row');
      const [ver] = await tx
        .insert(policyVersions)
        .values({ policyId: row.id, version: 1, orgId: actor.orgId, rules, createdBy: actor.principalId })
        .returning();
      if (!ver) throw new Error('policy version insert returned no row');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'policy.create',
        targetType: 'policy',
        targetId: row.id,
        data: { name, version: 1, rules },
      });
      await publish(tx, 'policy.updated', { orgId: actor.orgId, policyId: row.id, version: 1 });
      return { ...toDto(row), rules, versions: [toVersionDto(ver)] };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('policy_name_taken', `policy "${name}" already exists`);
    throw err;
  }
}

/** Name and description change in place; a rules change creates a new immutable version. */
export async function updatePolicy(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  policyId: string,
  input: { name?: string; description?: string; rules?: unknown },
): Promise<PolicyDetailDto> {
  await deps.authorizer.authorize(db, actor, 'agent.manage', {});
  const newRules = input.rules === undefined ? undefined : parseRules(input.rules);
  const newName = input.name === undefined ? undefined : normalizeName(input.name);
  try {
    await withTx(db, async (tx) => {
      const [cur] = await tx
        .select()
        .from(policies)
        .where(and(eq(policies.id, policyId), eq(policies.orgId, actor.orgId)))
        .for('update');
      if (!cur) throw notFound('policy');
      const [curVer] = await tx
        .select()
        .from(policyVersions)
        .where(
          and(
            eq(policyVersions.policyId, policyId),
            eq(policyVersions.version, cur.currentVersion),
            eq(policyVersions.orgId, actor.orgId),
          ),
        );
      const rulesChanged = newRules !== undefined && stable(newRules) !== stable(curVer?.rules);
      const version = rulesChanged ? cur.currentVersion + 1 : cur.currentVersion;
      const metaChanged =
        (newName !== undefined && newName !== cur.name) ||
        (input.description !== undefined && input.description !== cur.description);
      if (!rulesChanged && !metaChanged) return;
      if (rulesChanged) {
        await tx
          .insert(policyVersions)
          .values({ policyId, version, orgId: actor.orgId, rules: newRules, createdBy: actor.principalId });
      }
      await tx
        .update(policies)
        .set({
          name: newName ?? cur.name,
          description: input.description ?? cur.description,
          currentVersion: version,
          updatedAt: new Date(),
        })
        .where(and(eq(policies.id, policyId), eq(policies.orgId, actor.orgId)));
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: rulesChanged ? 'policy.version.create' : 'policy.update',
        targetType: 'policy',
        targetId: policyId,
        data: {
          ...(metaChanged && {
            name: newName ?? cur.name,
            description: input.description ?? cur.description,
          }),
          ...(rulesChanged && { version, rules: newRules }),
        },
      });
      await publish(tx, 'policy.updated', { orgId: actor.orgId, policyId, version });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('policy_name_taken', `policy "${newName}" already exists`);
    throw err;
  }
  return loadDetail(db, actor.orgId, policyId);
}

async function loadDetail(db: Db, orgId: string, policyId: string): Promise<PolicyDetailDto> {
  const [row] = await db
    .select()
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)));
  if (!row) throw notFound('policy');
  const vers = await db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.orgId, orgId)))
    .orderBy(asc(policyVersions.version));
  const versions = vers.map(toVersionDto);
  const current = versions.find((v) => v.version === row.currentVersion);
  return { ...toDto(row), rules: current?.rules ?? {}, versions };
}

export async function getPolicy(
  db: Db,
  deps: ModuleDeps,
  actor: ActorContext,
  policyId: string,
): Promise<PolicyDetailDto> {
  await deps.authorizer.authorize(db, actor, 'read', {});
  return loadDetail(db, actor.orgId, policyId);
}

export async function listPolicies(db: Db, deps: ModuleDeps, actor: ActorContext): Promise<PolicyDto[]> {
  await deps.authorizer.authorize(db, actor, 'read', {});
  const rows = await db
    .select()
    .from(policies)
    .where(eq(policies.orgId, actor.orgId))
    .orderBy(asc(policies.name));
  return rows.map(toDto);
}

/** For the modules that store policy bindings: does the policy exist in this org? */
export async function policyExists(db: Db, orgId: string, policyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)));
  return rows.length > 0;
}

/** Merge order is org, groups, agent; levels without a bound policy are skipped. */
export async function getEffectivePolicy(
  db: Db,
  agentId: string,
  ctx: { orgId: string; bindings: PolicyBindings },
): Promise<EffectivePolicy> {
  const b = await ctx.bindings.forAgent(db, agentId);
  const wanted: { level: 'org' | 'group' | 'agent'; policyId: string }[] = [];
  if (b.orgPolicyId) wanted.push({ level: 'org', policyId: b.orgPolicyId });
  for (const g of b.groups) if (g.policyId) wanted.push({ level: 'group', policyId: g.policyId });
  if (b.agentPolicyId) wanted.push({ level: 'agent', policyId: b.agentPolicyId });
  if (wanted.length === 0) return mergePolicies([]);

  const ids = [...new Set(wanted.map((w) => w.policyId))];
  const heads = await db
    .select()
    .from(policies)
    .where(and(eq(policies.orgId, ctx.orgId), inArray(policies.id, ids)));
  const vers = await db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.orgId, ctx.orgId), inArray(policyVersions.policyId, ids)));
  const levels = wanted.map((w) => {
    const head = heads.find((h) => h.id === w.policyId);
    const ver = head && vers.find((v) => v.policyId === w.policyId && v.version === head.currentVersion);
    if (!head || !ver) throw notFound(`policy ${w.policyId}`);
    return { level: w.level, policyId: w.policyId, version: ver.version, rules: parseRules(ver.rules) };
  });
  return mergePolicies(levels);
}
