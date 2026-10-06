import type {
  AgentMembership,
  EffectivePolicySource,
  EffectiveSkillsSource,
  PolicyBindings,
} from '../../ports/index.ts';
import { getEffectivePolicy } from '../../modules/policy/index.ts';
import { getEffectiveSkills, loadSkillBundle } from '../../modules/skills/index.ts';

export function createEffectivePolicySource(deps: { bindings: PolicyBindings }): EffectivePolicySource {
  return {
    forAgent: (db, orgId, agentId) => getEffectivePolicy(db, agentId, { orgId, bindings: deps.bindings }),
  };
}

export function createEffectiveSkillsSource(deps: { membership: AgentMembership }): EffectiveSkillsSource {
  return {
    forAgent: (db, orgId, agentId) => getEffectiveSkills(db, agentId, { orgId, membership: deps.membership }),
    async loadBundle(db, orgId, skillId, version) {
      return (await loadSkillBundle(db, skillId, version, orgId)).files;
    },
  };
}
