export type Role = 'owner' | 'admin' | 'operator' | 'viewer';
export type Scope = { org: true } | { agentGroupId: string } | { agentId: string };
export type Action = 'read' | 'task.write' | 'agent.manage' | 'org.manage' | 'audit.export';

export interface Binding {
  role: Role;
  scope: Scope;
}

// Empty resource = org-level resource.
export interface ResourceRef {
  agentId?: string;
  agentGroupIds?: string[];
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

const MIN_ROLE: Record<Action, Role> = {
  read: 'viewer',
  'task.write': 'operator',
  'agent.manage': 'admin',
  'org.manage': 'owner',
  'audit.export': 'owner',
};

const ORG_SCOPE_ONLY: ReadonlySet<Action> = new Set(['org.manage', 'audit.export']);

function covers(scope: Scope, res: ResourceRef): boolean {
  if ('org' in scope) return true;
  if ('agentGroupId' in scope) return res.agentGroupIds?.includes(scope.agentGroupId) ?? false;
  return res.agentId === scope.agentId;
}

export function decide(
  bindings: Binding[],
  action: Action,
  res: ResourceRef,
): { allow: boolean; reason: string } {
  const need = MIN_ROLE[action];
  const orgOnly = ORG_SCOPE_ONLY.has(action);
  for (const b of bindings) {
    if (ROLE_RANK[b.role] < ROLE_RANK[need]) continue;
    if (orgOnly && !('org' in b.scope)) continue;
    if (!covers(b.scope, res)) continue;
    return { allow: true, reason: `${b.role} binding grants ${action}` };
  }
  return {
    allow: false,
    reason: orgOnly
      ? `${action} requires an org-scope ${need} binding`
      : `no binding with role ${need} or higher covers this resource for ${action}`,
  };
}
