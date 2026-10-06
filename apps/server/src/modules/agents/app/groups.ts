import { and, eq } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx } from '../../../platform/tx.ts';
import type { ModuleDeps } from '../../../ports/index.ts';
import {
  createGroupSchema,
  parseInput,
  updateGroupSchema,
  type CreateGroupInput,
  type UpdateGroupInput,
} from '../domain/agent.ts';
import { groupIdsOfAgent, groupToDto, loadAgent, loadGroup, type AgentGroupDto } from '../infra/repo.ts';
import { agentGroupMembers, agentGroups } from '../infra/schema.ts';

export function createGroupUseCases(deps: ModuleDeps) {
  async function agentIdsOf(db: Db, orgId: string, groupId: string): Promise<string[]> {
    const rows = await db
      .select({ agentId: agentGroupMembers.agentId })
      .from(agentGroupMembers)
      .where(and(eq(agentGroupMembers.orgId, orgId), eq(agentGroupMembers.groupId, groupId)))
      .orderBy(agentGroupMembers.createdAt, agentGroupMembers.agentId);
    return rows.map((r) => r.agentId);
  }

  async function assertNameFree(db: Db, orgId: string, name: string, exceptId?: string): Promise<void> {
    const rows = await db
      .select({ id: agentGroups.id })
      .from(agentGroups)
      .where(and(eq(agentGroups.orgId, orgId), eq(agentGroups.name, name)));
    if (rows.some((r) => r.id !== exceptId)) {
      throw conflict('group_name_taken', `Agent group "${name}" already exists`);
    }
  }

  async function createGroup(db: Db, actor: ActorContext, input: CreateGroupInput): Promise<AgentGroupDto> {
    const v = parseInput(createGroupSchema, input);
    await deps.authorizer.authorize(db, actor, 'agent.manage', {});
    return withTx(db, async (tx) => {
      await assertNameFree(tx, actor.orgId, v.name);
      const [row] = await tx
        .insert(agentGroups)
        .values({
          orgId: actor.orgId,
          name: v.name,
          description: v.description,
          labels: v.labels,
          policyId: v.policyId ?? null,
          createdBy: actor.principalId,
        })
        .returning();
      if (!row) throw new Error('group insert returned no row');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent_group.created',
        targetType: 'agent_group',
        targetId: row.id,
        data: { name: row.name },
      });
      await publish(tx, 'agent_group.created', { orgId: actor.orgId, groupId: row.id });
      return groupToDto(row, []);
    });
  }

  async function updateGroup(
    db: Db,
    actor: ActorContext,
    id: string,
    input: UpdateGroupInput,
  ): Promise<AgentGroupDto> {
    const v = parseInput(updateGroupSchema, input);
    await loadGroup(db, actor.orgId, id);
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentGroupIds: [id] });
    return withTx(db, async (tx) => {
      if (v.name !== undefined) await assertNameFree(tx, actor.orgId, v.name, id);
      const [row] = await tx
        .update(agentGroups)
        .set({
          ...(v.name !== undefined && { name: v.name }),
          ...(v.description !== undefined && { description: v.description }),
          ...(v.labels !== undefined && { labels: v.labels }),
          ...(v.policyId !== undefined && { policyId: v.policyId }),
        })
        .where(and(eq(agentGroups.orgId, actor.orgId), eq(agentGroups.id, id)))
        .returning();
      if (!row) throw new Error('group update returned no row');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent_group.updated',
        targetType: 'agent_group',
        targetId: id,
        data: { changed: Object.keys(v) },
      });
      await publish(tx, 'agent_group.updated', { orgId: actor.orgId, groupId: id });
      return groupToDto(row, await agentIdsOf(tx, actor.orgId, id));
    });
  }

  async function deleteGroup(db: Db, actor: ActorContext, id: string): Promise<void> {
    const group = await loadGroup(db, actor.orgId, id);
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentGroupIds: [id] });
    await withTx(db, async (tx) => {
      const members = await agentIdsOf(tx, actor.orgId, id);
      await tx.delete(agentGroups).where(and(eq(agentGroups.orgId, actor.orgId), eq(agentGroups.id, id)));
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent_group.deleted',
        targetType: 'agent_group',
        targetId: id,
        data: { name: group.name, agentIds: members },
      });
      await publish(tx, 'agent_group.deleted', { orgId: actor.orgId, groupId: id });
    });
  }

  async function addAgentToGroup(
    db: Db,
    actor: ActorContext,
    groupId: string,
    agentId: string,
  ): Promise<AgentGroupDto> {
    await loadGroup(db, actor.orgId, groupId);
    await loadAgent(db, actor.orgId, agentId);
    const current = await groupIdsOfAgent(db, agentId);
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentGroupIds: [groupId] });
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentId, agentGroupIds: current });
    return withTx(db, async (tx) => {
      await tx
        .insert(agentGroupMembers)
        .values({ groupId, agentId, orgId: actor.orgId })
        .onConflictDoNothing();
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent_group.member_added',
        targetType: 'agent_group',
        targetId: groupId,
        data: { agentId },
      });
      await publish(tx, 'agent_group.member_added', { orgId: actor.orgId, groupId, agentId });
      return groupToDto(
        await loadGroup(tx, actor.orgId, groupId),
        await agentIdsOf(tx, actor.orgId, groupId),
      );
    });
  }

  async function removeAgentFromGroup(
    db: Db,
    actor: ActorContext,
    groupId: string,
    agentId: string,
  ): Promise<AgentGroupDto> {
    await loadGroup(db, actor.orgId, groupId);
    await loadAgent(db, actor.orgId, agentId);
    const current = await groupIdsOfAgent(db, agentId);
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentGroupIds: [groupId] });
    await deps.authorizer.authorize(db, actor, 'agent.manage', { agentId, agentGroupIds: current });
    return withTx(db, async (tx) => {
      await tx
        .delete(agentGroupMembers)
        .where(and(eq(agentGroupMembers.groupId, groupId), eq(agentGroupMembers.agentId, agentId)));
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'agent_group.member_removed',
        targetType: 'agent_group',
        targetId: groupId,
        data: { agentId },
      });
      await publish(tx, 'agent_group.member_removed', { orgId: actor.orgId, groupId, agentId });
      return groupToDto(
        await loadGroup(tx, actor.orgId, groupId),
        await agentIdsOf(tx, actor.orgId, groupId),
      );
    });
  }

  async function listGroups(db: Db, actor: ActorContext): Promise<AgentGroupDto[]> {
    await deps.authorizer.authorize(db, actor, 'read', {});
    const groups = await db
      .select()
      .from(agentGroups)
      .where(eq(agentGroups.orgId, actor.orgId))
      .orderBy(agentGroups.createdAt, agentGroups.name);
    const members = await db.select().from(agentGroupMembers).where(eq(agentGroupMembers.orgId, actor.orgId));
    return groups.map((g) =>
      groupToDto(
        g,
        members.filter((m) => m.groupId === g.id).map((m) => m.agentId),
      ),
    );
  }

  return { createGroup, updateGroup, deleteGroup, addAgentToGroup, removeAgentFromGroup, listGroups };
}
