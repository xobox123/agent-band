import { and, eq, inArray } from 'drizzle-orm';
import { notFound } from '../../../platform/errors.ts';
import type { AgentMembership, DbOrTx, PolicyBindings } from '../../../ports/index.ts';
import { groupIdsOfAgent } from '../infra/repo.ts';
import { agentGroups, agents } from '../infra/schema.ts';

export function createAgentMembership(): AgentMembership {
  return { groupIdsOf: (db, agentId) => groupIdsOfAgent(db, agentId) };
}

/** `orgPolicyId` is injected so this module never reads the org module's tables. */
export function createPolicyBindings(opts: {
  orgPolicyId: (db: DbOrTx, orgId: string) => Promise<string | null>;
}): PolicyBindings {
  return {
    async forAgent(db, agentId) {
      const rows = await db.select().from(agents).where(eq(agents.id, agentId));
      const agent = rows[0];
      if (!agent) throw notFound('Agent');
      const groupIds = await groupIdsOfAgent(db, agentId);
      const groupRows =
        groupIds.length === 0
          ? []
          : await db
              .select({ id: agentGroups.id, policyId: agentGroups.policyId })
              .from(agentGroups)
              .where(and(eq(agentGroups.orgId, agent.orgId), inArray(agentGroups.id, groupIds)));
      const policyByGroup = new Map(groupRows.map((g) => [g.id, g.policyId]));
      return {
        orgPolicyId: await opts.orgPolicyId(db, agent.orgId),
        groups: groupIds.map((groupId) => ({ groupId, policyId: policyByGroup.get(groupId) ?? null })),
        agentPolicyId: agent.policyId,
      };
    },
  };
}
