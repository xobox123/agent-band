import { and, eq } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { forbidden } from '../../../platform/errors.ts';
import { withTx, type Tx } from '../../../platform/tx.ts';
import type { Authorizer } from '../../../ports/index.ts';
import { appendAudit } from '../../audit/index.ts';
import { decide, type Action, type Binding, type ResourceRef } from '../domain/rbac.ts';
import { roleBindings, teamMembers } from '../infra/schema.ts';

// Internal actors act through use cases, not through human role bindings.
const INTERNAL_ACTIONS: Record<'agent' | 'system', ReadonlySet<Action>> = {
  system: new Set<Action>(['read', 'task.write', 'agent.manage']),
  agent: new Set<Action>(['read', 'task.write']),
};

export async function loadBindings(db: Db | Tx, orgId: string, userId: string): Promise<Binding[]> {
  const q = db;
  const teams = await q
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.orgId, orgId), eq(teamMembers.userId, userId)));
  const teamIds = teams.map((t) => t.teamId);
  const rows = await q.select().from(roleBindings).where(eq(roleBindings.orgId, orgId));
  const mine = rows.filter(
    (r) =>
      (r.subjectType === 'user' && r.subjectId === userId) ||
      (r.subjectType === 'team' && teamIds.includes(r.subjectId)),
  );
  return mine.map((r) => ({
    role: r.role,
    scope:
      r.scopeType === 'org'
        ? { org: true as const }
        : r.scopeType === 'agentGroup'
          ? { agentGroupId: r.scopeId ?? '' }
          : { agentId: r.scopeId ?? '' },
  }));
}

export async function authorize(
  db: Db | Tx,
  actor: ActorContext,
  action: Action,
  res: ResourceRef,
): Promise<void> {
  let result: { allow: boolean; reason: string };
  if (actor.kind === 'user') {
    result = decide(await loadBindings(db, actor.orgId, actor.principalId), action, res);
  } else {
    const allow = INTERNAL_ACTIONS[actor.kind].has(action);
    result = {
      allow,
      reason: allow ? `${actor.kind} actor allowed ${action}` : `${actor.kind} actors cannot ${action}`,
    };
  }
  if (result.allow) return;

  // Pass a Db (not a Tx) so the denial record survives the caller's rollback.
  await withTx(db as Db, (tx) =>
    appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'authz.denied',
      targetType: 'authorization',
      targetId: action,
      data: { action, resource: res, reason: result.reason, requestId: actor.requestId },
    }),
  );
  throw forbidden(result.reason);
}

export const authorizer: Authorizer = { authorize };
