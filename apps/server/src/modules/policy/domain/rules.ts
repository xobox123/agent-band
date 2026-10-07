export type Mode = 'read-only' | 'edit' | 'full-auto';

const MODE_ORDER: readonly Mode[] = ['read-only', 'edit', 'full-auto'];

export function minMode(a: Mode, b: Mode): Mode {
  return MODE_ORDER.indexOf(a) <= MODE_ORDER.indexOf(b) ? a : b;
}

export { PolicyRules } from '@agent-band/contracts';
import type { PolicyRules } from '@agent-band/contracts';

export type DelegateTargets = NonNullable<PolicyRules['delegateTargets']>;

export type PolicyLevel = 'org' | 'group' | 'agent';

export interface EffectivePolicy {
  workDirSets: string[][];
  maxMode: Mode;
  allowedTools?: string[];
  deniedTools: string[];
  preApprovedTools?: string[];
  presets?: string[];
  dailyTokenBudget?: number;
  maxRunMinutes?: number;
  allowedAccountIds?: string[];
  allowedSkillIds?: string[];
  allowAccountFailover?: boolean;
  canDelegate?: boolean;
  delegateTargets?: DelegateTargets;
  maxSubtasks?: number;
  maxRounds?: number;
  treeTokenBudget?: number;
  provenance?: Partial<
    Record<
      keyof PolicyRules,
      {
        setBy: { level: PolicyLevel; policyId: string; version: number } | null;
        contributors: { level: PolicyLevel; policyId: string; version: number }[];
      }
    >
  >;
  sources: { level: PolicyLevel; policyId: string; version: number }[];
}

function intersect(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined) return b === undefined ? undefined : [...new Set(b)];
  if (b === undefined) return [...new Set(a)];
  const inB = new Set(b);
  return [...new Set(a.filter((x) => inB.has(x)))];
}

function minNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function mergeDimension(
  key: keyof DelegateTargets,
  current: DelegateTargets | undefined,
  next: string[] | undefined,
): DelegateTargets {
  const merged = intersect(current?.[key], next);
  return merged === undefined ? {} : { [key]: merged };
}

function mergePolicyValues(
  levels: { level: PolicyLevel; policyId: string; version: number; rules: PolicyRules }[],
): EffectivePolicy {
  const sources: EffectivePolicy['sources'] = [];
  const workDirSets: string[][] = [];
  const denied = new Set<string>();
  let maxMode: Mode = 'full-auto';
  let allowedTools: string[] | undefined;
  let preApprovedTools: string[] | undefined;
  let presets: string[] | undefined;
  let allowedAccountIds: string[] | undefined;
  let allowedSkillIds: string[] | undefined;
  let dailyTokenBudget: number | undefined;
  let maxRunMinutes: number | undefined;
  let allowAccountFailover: boolean | undefined;
  let canDelegate: boolean | undefined;
  let targets: DelegateTargets | undefined;
  let maxSubtasks: number | undefined;
  let maxRounds: number | undefined;
  let treeTokenBudget: number | undefined;

  for (const { level, policyId, version, rules } of levels) {
    sources.push({ level, policyId, version });
    if (rules.workDirs !== undefined) workDirSets.push([...rules.workDirs]);
    if (rules.maxMode !== undefined) maxMode = minMode(maxMode, rules.maxMode);
    for (const t of rules.deniedTools ?? []) denied.add(t);
    allowedTools = intersect(allowedTools, rules.allowedTools);
    preApprovedTools = intersect(preApprovedTools, rules.preApprovedTools);
    presets = intersect(presets, rules.presets);
    allowedAccountIds = intersect(allowedAccountIds, rules.allowedAccountIds);
    allowedSkillIds = intersect(allowedSkillIds, rules.allowedSkillIds);
    dailyTokenBudget = minNumber(dailyTokenBudget, rules.dailyTokenBudget);
    maxRunMinutes = minNumber(maxRunMinutes, rules.maxRunMinutes);
    // Failover is opt-in and any explicit false wins.
    if (rules.allowAccountFailover === false) allowAccountFailover = false;
    else if (rules.allowAccountFailover === true && allowAccountFailover === undefined)
      allowAccountFailover = true;
    // Delegation is opt-in and any explicit false wins.
    if (rules.canDelegate === false) canDelegate = false;
    else if (rules.canDelegate === true && canDelegate === undefined) canDelegate = true;
    if (rules.delegateTargets) {
      const t = rules.delegateTargets;
      targets = {
        ...(targets ?? {}),
        ...mergeDimension('agentIds', targets, t.agentIds),
        ...mergeDimension('labels', targets, t.labels),
        ...mergeDimension('groupIds', targets, t.groupIds),
      };
    }
    maxSubtasks = minNumber(maxSubtasks, rules.maxSubtasks);
    maxRounds = minNumber(maxRounds, rules.maxRounds);
    treeTokenBudget = minNumber(treeTokenBudget, rules.treeTokenBudget);
  }

  // Unset limits stay absent so the stored snapshot has no undefined members.
  return {
    workDirSets,
    maxMode,
    ...(allowedTools && { allowedTools }),
    deniedTools: [...denied],
    ...(preApprovedTools && { preApprovedTools }),
    ...(presets && { presets }),
    ...(dailyTokenBudget !== undefined && { dailyTokenBudget }),
    ...(maxRunMinutes !== undefined && { maxRunMinutes }),
    ...(allowedAccountIds && { allowedAccountIds }),
    ...(allowedSkillIds && { allowedSkillIds }),
    ...(allowAccountFailover !== undefined && { allowAccountFailover }),
    ...(canDelegate !== undefined && { canDelegate }),
    ...(targets && { delegateTargets: targets }),
    ...(maxSubtasks !== undefined && { maxSubtasks }),
    ...(maxRounds !== undefined && { maxRounds }),
    ...(treeTokenBudget !== undefined && { treeTokenBudget }),
    sources,
  };
}

export function mergePolicies(
  levels: { level: PolicyLevel; policyId: string; version: number; rules: PolicyRules }[],
): EffectivePolicy {
  const provenance: NonNullable<EffectivePolicy['provenance']> = {};
  let previous = mergePolicyValues([]);
  for (let i = 0; i < levels.length; i++) {
    const source = levels[i];
    if (!source) continue;
    const next = mergePolicyValues(levels.slice(0, i + 1));
    const { level, policyId, version } = source;
    for (const key of Object.keys(source.rules) as (keyof PolicyRules)[]) {
      const field = key === 'workDirs' ? 'workDirSets' : key;
      const current = provenance[key];
      const changed = JSON.stringify(previous[field]) !== JSON.stringify(next[field]);
      provenance[key] = {
        setBy: changed || !current ? { level, policyId, version } : current.setBy,
        contributors: [...(current?.contributors ?? []), { level, policyId, version }],
      };
    }
    previous = next;
  }
  return { ...previous, provenance };
}
