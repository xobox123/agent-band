import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../platform/actor.ts';
import { forbidden } from '../platform/errors.ts';
import type { Action, ResourceRef } from '../modules/org/domain/rbac.ts';
import type { EffectivePolicy } from '../modules/policy/domain/rules.ts';
import type {
  AgentMembership,
  AuditEntry,
  AuditLog,
  Authorizer,
  EffectivePolicySource,
  EffectiveSkill,
  EffectiveSkillsSource,
  ModuleDeps,
  OrgSettings,
  PolicyBindings,
  PrincipalRegistry,
} from './index.ts';

export class FakeAuthorizer implements Authorizer {
  readonly checks: { actor: ActorContext; action: Action; resource: ResourceRef }[] = [];
  deny: ((action: Action, resource: ResourceRef, actor: ActorContext) => boolean) | null = null;

  authorize(_db: unknown, actor: ActorContext, action: Action, resource: ResourceRef): Promise<void> {
    this.checks.push({ actor, action, resource });
    if (this.deny?.(action, resource, actor)) return Promise.reject(forbidden(`fake deny ${action}`));
    return Promise.resolve();
  }
}

export class FakeAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];
  append(_tx: unknown, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

export class FakePrincipalRegistry implements PrincipalRegistry {
  readonly created: { id: string; handle: string }[] = [];
  create(_tx: unknown, p: { handle: string }): Promise<{ id: string }> {
    const id = randomUUID();
    this.created.push({ id, handle: p.handle });
    return Promise.resolve({ id });
  }
}

export class FakeAgentMembership implements AgentMembership {
  constructor(public readonly groups: Record<string, string[]> = {}) {}
  groupIdsOf(_db: unknown, agentId: string): Promise<string[]> {
    return Promise.resolve(this.groups[agentId] ?? []);
  }
}

export class FakePolicyBindings implements PolicyBindings {
  constructor(
    public readonly byAgent: Awaited<ReturnType<PolicyBindings['forAgent']>> = {
      orgPolicyId: null,
      groups: [],
      agentPolicyId: null,
    },
  ) {}
  forAgent(): ReturnType<PolicyBindings['forAgent']> {
    return Promise.resolve(this.byAgent);
  }
}

export class FakeOrgSettings implements OrgSettings {
  constructor(public readonly settings = { taskKeyPrefix: 'AB', timezone: 'UTC' }) {}
  get(): ReturnType<OrgSettings['get']> {
    return Promise.resolve(this.settings);
  }
}

export const openPolicy = (overrides: Partial<EffectivePolicy> = {}): EffectivePolicy => ({
  workDirSets: [],
  maxMode: 'full-auto',
  deniedTools: [],
  sources: [],
  ...overrides,
});

export class FakeEffectivePolicySource implements EffectivePolicySource {
  readonly byAgent = new Map<string, EffectivePolicy>();
  constructor(public fallback: EffectivePolicy = openPolicy()) {}
  forAgent(_db: unknown, _orgId: string, agentId: string): Promise<EffectivePolicy> {
    return Promise.resolve(this.byAgent.get(agentId) ?? this.fallback);
  }
}

export class FakeEffectiveSkillsSource implements EffectiveSkillsSource {
  readonly byAgent = new Map<string, EffectiveSkill[]>();
  readonly bundles = new Map<string, Record<string, Uint8Array>>();
  constructor(public fallback: EffectiveSkill[] = []) {}
  forAgent(_db: unknown, _orgId: string, agentId: string): Promise<EffectiveSkill[]> {
    return Promise.resolve(this.byAgent.get(agentId) ?? this.fallback);
  }
  loadBundle(
    _db: unknown,
    _orgId: string,
    skillId: string,
    version: number,
  ): Promise<Record<string, Uint8Array>> {
    return Promise.resolve(this.bundles.get(`${skillId}@${version}`) ?? {});
  }
}

export function fakeDeps(): ModuleDeps & { authorizer: FakeAuthorizer; audit: FakeAuditLog } {
  return { authorizer: new FakeAuthorizer(), audit: new FakeAuditLog() };
}

export function testActor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    orgId: randomUUID(),
    principalId: randomUUID(),
    kind: 'user',
    requestId: randomUUID(),
    ...overrides,
  };
}
