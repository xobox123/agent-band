import { and, eq, isNull } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx } from '../../../platform/tx.ts';
import type { DbOrTx, ModuleDeps, PrincipalRegistry } from '../../../ports/index.ts';
import {
  agentHandle,
  createAgentSchema,
  defaultGitIdentity,
  parseInput,
  updateAgentSchema,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '../domain/agent.ts';
import {
  agentToDto,
  groupIdsOfAgent,
  loadAgent,
  loadGroup,
  membershipsByAgent,
  type AgentDto,
} from '../infra/repo.ts';
import { agentGroupMembers, agents } from '../infra/schema.ts';

export interface AgentsDeps extends ModuleDeps {
  principals: PrincipalRegistry;
  /** Provided by the accounts module public API. */
  accountExists: (db: DbOrTx, orgId: string, accountId: string) => Promise<boolean>;
}

export function createAgentUseCases(deps: AgentsDeps) {
  async function requireAccount(db: DbOrTx, orgId: string, accountId: string): Promise<void> {
    if (!(await deps.accountExists(db, orgId, accountId))) {
      throw invalid([{ path: 'accountId', message: 'account does not exist' }]);
    }
  }

  async function createAgent(db: Db, actor: ActorContext, input: CreateAgentInput): Promise<AgentDto> {
    const v = parseInput(createAgentSchema, input);
    if (v.groupIds.length === 0) await deps.authorizer.authorize(db, actor, 'agent.manage', {});
    for (const groupId of v.groupIds) {
      await deps.authorizer.authorize(db, actor, 'agent.manage', { agentGroupIds: [groupId] });
    }
    await requireAccount(db, actor.orgId, v.accountId);
    const groupIds = [...new Set(v.groupIds)];
    for (const groupId of groupIds) await loadGroup(db, actor.orgId, groupId);

    return withTx(db, async (tx) => {
      const taken = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.orgId, actor.orgId), eq(agents.slug, v.slug)));
      if (taken.length > 0) throw conflict('slug_taken', `Agent slug "${v.slug}" is already in use`);

      const principal = await deps.principals.create(tx, {
        orgId: actor.orgId,
        kind: 'agent',
        handle: agentHandle(v.slug),
        displayName: v.name,
        ...(v.avatar ? { avatar: v.avatar } : {}),
      });
      const git = v.gitIdentity ?? defaultGitIdentity(v.name, v.slug);
      const now = new Date();
      const [row] = await tx
        .insert(agents)
        .values({
          id: principal.id,
          orgId: actor.orgId,
          slug: v.slug,
          name: v.name,
          avatar: v.avatar || null,
          accountId: v.accountId,
          model: v.model || null,
          role: v.role,
          persona: v.persona || null,
          systemPrompt: v.systemPrompt || null,
          labels: v.labels,
          policyId: v.policyId ?? null,
          enabled: v.enabled,
          gitName: git.name,
          gitEmail: git.email,
          createdBy: actor.principalId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('agent insert returned no row');
      if (groupIds.length > 0) {
        await tx
          .insert(agentGroupMembers)
          .values(groupIds.map((groupId) => ({ groupId, agentId: row.id, orgId: actor.orgId })));
      }
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent.created',
        targetType: 'agent',
        targetId: row.id,
        data: { slug: row.slug, name: row.name, accountId: row.accountId, role: row.role, groupIds },
      });
      await publish(tx, 'agent.created', { orgId: actor.orgId, agentId: row.id });
      return agentToDto(row, groupIds);
    });
  }

  async function updateAgent(
    db: Db,
    actor: ActorContext,
    id: string,
    input: UpdateAgentInput,
  ): Promise<AgentDto> {
    const v = parseInput(updateAgentSchema, input);
    const current = await loadAgent(db, actor.orgId, id);
    const groupIds = await groupIdsOfAgent(db, id);
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentId: id, agentGroupIds: groupIds });
    if (v.accountId !== undefined && v.accountId !== current.accountId) {
      await requireAccount(db, actor.orgId, v.accountId);
    }

    return withTx(db, async (tx) => {
      const [row] = await tx
        .update(agents)
        .set({
          ...(v.name !== undefined && { name: v.name }),
          ...(v.avatar !== undefined && { avatar: v.avatar || null }),
          ...(v.accountId !== undefined && { accountId: v.accountId }),
          ...(v.model !== undefined && { model: v.model || null }),
          ...(v.role !== undefined && { role: v.role }),
          ...(v.persona !== undefined && { persona: v.persona || null }),
          ...(v.systemPrompt !== undefined && { systemPrompt: v.systemPrompt || null }),
          ...(v.labels !== undefined && { labels: v.labels }),
          ...(v.policyId !== undefined && { policyId: v.policyId }),
          ...(v.enabled !== undefined && { enabled: v.enabled }),
          ...(v.gitIdentity !== undefined && { gitName: v.gitIdentity.name, gitEmail: v.gitIdentity.email }),
          updatedAt: new Date(),
        })
        .where(and(eq(agents.orgId, actor.orgId), eq(agents.id, id), isNull(agents.deletedAt)))
        .returning();
      if (!row) throw notFound('Agent');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent.updated',
        targetType: 'agent',
        targetId: id,
        data: { changed: Object.keys(v) },
      });
      await publish(tx, 'agent.updated', { orgId: actor.orgId, agentId: id });
      return agentToDto(row, groupIds);
    });
  }

  /** Soft delete: the row and its principal stay for audit and run history. */
  async function deleteAgent(db: Db, actor: ActorContext, id: string): Promise<void> {
    const current = await loadAgent(db, actor.orgId, id);
    const groupIds = await groupIdsOfAgent(db, id);
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentId: id, agentGroupIds: groupIds });
    await withTx(db, async (tx) => {
      const now = new Date();
      await tx
        .update(agents)
        .set({ enabled: false, deletedAt: now, updatedAt: now })
        .where(and(eq(agents.orgId, actor.orgId), eq(agents.id, id)));
      await tx.delete(agentGroupMembers).where(eq(agentGroupMembers.agentId, id));
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent.deleted',
        targetType: 'agent',
        targetId: id,
        data: { slug: current.slug, groupIds },
      });
      await publish(tx, 'agent.deleted', { orgId: actor.orgId, agentId: id });
    });
  }

  async function listAgents(
    db: Db,
    actor: ActorContext,
    filter: { label?: string; groupId?: string; enabled?: boolean } = {},
  ): Promise<AgentDto[]> {
    await deps.authorizer.authorize(
      db,
      actor,
      'read',
      filter.groupId ? { agentGroupIds: [filter.groupId] } : {},
    );
    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, actor.orgId), isNull(agents.deletedAt)))
      .orderBy(agents.createdAt, agents.slug);
    const memberships = await membershipsByAgent(
      db,
      actor.orgId,
      rows.map((r) => r.id),
    );
    return rows
      .map((r) => agentToDto(r, memberships.get(r.id) ?? []))
      .filter(
        (a) =>
          (filter.label === undefined || a.labels.includes(filter.label)) &&
          (filter.groupId === undefined || a.groupIds.includes(filter.groupId)) &&
          (filter.enabled === undefined || a.enabled === filter.enabled),
      );
  }

  async function getAgent(db: Db, actor: ActorContext, id: string): Promise<AgentDto> {
    const row = await loadAgent(db, actor.orgId, id);
    const groupIds = await groupIdsOfAgent(db, id);
    await deps.authorizer.authorize(db, actor, 'read', { agentId: id, agentGroupIds: groupIds });
    return agentToDto(row, groupIds);
  }

  return { createAgent, updateAgent, deleteAgent, listAgents, getAgent };
}

/** Used by the accounts module to refuse deleting an account that live agents still use. */
export async function accountHasAgents(db: DbOrTx, orgId: string, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.accountId, accountId), isNull(agents.deletedAt)))
    .limit(1);
  return rows.length > 0;
}
