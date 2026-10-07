import type { EffectivePolicyDto, PolicyRules } from '@agent-band/contracts';

export const RULE_KEYS = [
  'workDirs',
  'maxMode',
  'allowedTools',
  'deniedTools',
  'presets',
  'preApprovedTools',
  'dailyTokenBudget',
  'maxRunMinutes',
  'allowedAccountIds',
  'allowedSkillIds',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface SourceRules {
  level: 'org' | 'group' | 'agent';
  policyId: string;
  policyName: string;
  version: number;
  rules: PolicyRules;
}

export interface PolicyRow {
  rule: RuleKey;
  value: string;
  setBy: string[];
}

function show(value: unknown): string {
  if (value === undefined) return 'Not set';
  if (Array.isArray(value)) return value.length === 0 ? 'None' : value.join(', ');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function effectiveValue(effective: EffectivePolicyDto, rule: RuleKey): string {
  switch (rule) {
    case 'workDirs': {
      const sets = effective.workDirSets;
      if (sets.length === 0) return 'No directory restriction';
      return sets.map((s) => (s.length === 0 ? 'No allowed directory' : s.join(', '))).join(' AND ');
    }
    case 'deniedTools':
      return effective.deniedTools.length === 0 ? 'None' : effective.deniedTools.join(', ');
    case 'maxMode':
      return effective.maxMode;
    default:
      return effective[rule] === undefined ? 'Not set' : show(effective[rule]);
  }
}

/** Per-rule attribution: which source level defines the rule, from the versions the merge used. */
export function policyRows(effective: EffectivePolicyDto, sources: SourceRules[]): PolicyRow[] {
  return RULE_KEYS.map((rule) => ({
    rule,
    value: effectiveValue(effective, rule),
    setBy: sources
      .filter((s) => s.rules[rule] !== undefined)
      .map((s) => `${s.level}: ${s.policyName} v${String(s.version)} (${show(s.rules[rule])})`),
  }));
}
