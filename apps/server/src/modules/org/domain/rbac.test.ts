import { describe, expect, it } from 'vitest';
import { type Action, type Binding, type Role, type Scope, decide } from './rbac.ts';

const roles: Role[] = ['viewer', 'operator', 'admin', 'owner'];
const actions: Action[] = ['read', 'task.write', 'agent.manage', 'org.manage', 'audit.export'];

const minRole: Record<Action, Role> = {
  read: 'viewer',
  'task.write': 'operator',
  'agent.manage': 'admin',
  'org.manage': 'owner',
  'audit.export': 'owner',
};
const rank = (r: Role) => roles.indexOf(r);

type ScopeKind = 'org' | 'group-match' | 'group-other' | 'agent-match' | 'agent-other';
const scopes: Record<ScopeKind, Scope> = {
  org: { org: true },
  'group-match': { agentGroupId: 'g1' },
  'group-other': { agentGroupId: 'g2' },
  'agent-match': { agentId: 'a1' },
  'agent-other': { agentId: 'a2' },
};
const agentRes = { agentId: 'a1', agentGroupIds: ['g1', 'g3'] };
const orgRes = {};

function covers(kind: ScopeKind, orgLevel: boolean): boolean {
  if (kind === 'org') return true;
  if (orgLevel) return false;
  return kind === 'group-match' || kind === 'agent-match';
}

describe('decide: role x action x scope x resource', () => {
  for (const role of roles) {
    for (const action of actions) {
      for (const kind of Object.keys(scopes) as ScopeKind[]) {
        for (const orgLevel of [false, true]) {
          const needsOrgScope = action === 'org.manage' || action === 'audit.export';
          const expected =
            rank(role) >= rank(minRole[action]) &&
            covers(kind, orgLevel) &&
            (!needsOrgScope || kind === 'org');
          it(`${role} ${action} scope=${kind} ${orgLevel ? 'org resource' : 'agent resource'} -> ${expected}`, () => {
            const d = decide([{ role, scope: scopes[kind] }], action, orgLevel ? orgRes : agentRes);
            expect(d.allow).toBe(expected);
            expect(d.reason.length).toBeGreaterThan(0);
          });
        }
      }
    }
  }
});

describe('decide: combinations', () => {
  it('denies with no bindings', () => {
    const d = decide([], 'read', {});
    expect(d.allow).toBe(false);
    expect(d.reason).not.toBe('');
  });

  it('allows when any binding grants the action', () => {
    const b: Binding[] = [
      { role: 'viewer', scope: { org: true } },
      { role: 'admin', scope: { agentGroupId: 'g1' } },
    ];
    expect(decide(b, 'agent.manage', { agentId: 'a9', agentGroupIds: ['g1'] }).allow).toBe(true);
    expect(decide(b, 'agent.manage', { agentId: 'a9', agentGroupIds: ['g2'] }).allow).toBe(false);
    expect(decide(b, 'read', { agentId: 'a9', agentGroupIds: ['g2'] }).allow).toBe(true);
  });

  it('does not let a weaker org binding combine with a stronger scoped one for org actions', () => {
    const b: Binding[] = [
      { role: 'viewer', scope: { org: true } },
      { role: 'owner', scope: { agentId: 'a1' } },
    ];
    expect(decide(b, 'org.manage', {}).allow).toBe(false);
  });

  it('treats missing agentGroupIds as no groups', () => {
    expect(decide([{ role: 'admin', scope: { agentGroupId: 'g1' } }], 'read', { agentId: 'a1' }).allow).toBe(
      false,
    );
  });
});
