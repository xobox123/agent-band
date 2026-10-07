import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../../../ports/index.ts';
import { notFound } from '../../../platform/errors.ts';
import { agentGroupMembers, agentGroups, agents } from './schema.ts';

export type AgentRow = typeof agents.$inferSelect;
export type GroupRow = typeof agentGroups.$inferSelect;

import type { AgentDto } from '@agent-band/contracts';
export type { AgentDto } from '@agent-band/contracts';

export interface AgentGroupDto {
  id: string;
  orgId: string;
  name: string;
  description: string;
  labels: string[];
  policyId: string | null;
  agentIds: string[];
  createdBy: string;
  createdAt: string;
}

export function agentToDto(r: AgentRow, groupIds: string[]): AgentDto {
  return {
    id: r.id,
    orgId: r.orgId,
    slug: r.slug,
    handle: `agent:${r.slug}`,
    name: r.name,
    avatar: r.avatar,
    accountId: r.accountId,
    model: r.model,
    role: r.role as AgentDto['role'],
    persona: r.persona,
    systemPrompt: r.systemPrompt,
    labels: r.labels,
    groupIds,
    policyId: r.policyId,
    enabled: r.enabled,
    paused: r.paused,
    gitIdentity: { name: r.gitName, email: r.gitEmail },
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function groupToDto(r: GroupRow, agentIds: string[]): AgentGroupDto {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description,
    labels: r.labels,
    policyId: r.policyId,
    agentIds,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function loadAgent(db: DbOrTx, orgId: string, id: string): Promise<AgentRow> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, id), isNull(agents.deletedAt)));
  const row = rows[0];
  if (!row) throw notFound('Agent');
  return row;
}

export async function loadGroup(db: DbOrTx, orgId: string, id: string): Promise<GroupRow> {
  const rows = await db
    .select()
    .from(agentGroups)
    .where(and(eq(agentGroups.orgId, orgId), eq(agentGroups.id, id)));
  const row = rows[0];
  if (!row) throw notFound('Agent group');
  return row;
}

export async function groupIdsOfAgent(db: DbOrTx, agentId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: agentGroupMembers.groupId })
    .from(agentGroupMembers)
    .where(eq(agentGroupMembers.agentId, agentId))
    .orderBy(agentGroupMembers.createdAt, agentGroupMembers.groupId);
  return rows.map((r) => r.groupId);
}

export async function membershipsByAgent(
  db: DbOrTx,
  orgId: string,
  agentIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (agentIds.length === 0) return map;
  const rows = await db
    .select()
    .from(agentGroupMembers)
    .where(and(eq(agentGroupMembers.orgId, orgId), inArray(agentGroupMembers.agentId, agentIds)))
    .orderBy(agentGroupMembers.createdAt, agentGroupMembers.groupId);
  for (const r of rows) map.set(r.agentId, [...(map.get(r.agentId) ?? []), r.groupId]);
  return map;
}
