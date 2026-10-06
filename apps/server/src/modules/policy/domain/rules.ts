import { z } from 'zod';

export type Mode = 'read-only' | 'edit' | 'full-auto';

const MODE_ORDER: readonly Mode[] = ['read-only', 'edit', 'full-auto'];

export function minMode(a: Mode, b: Mode): Mode {
  return MODE_ORDER.indexOf(a) <= MODE_ORDER.indexOf(b) ? a : b;
}

const ModeSchema = z.enum(['read-only', 'edit', 'full-auto']);
const absolutePath = z
  .string()
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'must be an absolute path');

export const PolicyRules = z.strictObject({
  workDirs: z.array(absolutePath).optional(),
  maxMode: ModeSchema.optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  deniedTools: z.array(z.string().min(1)).optional(),
  dailyTokenBudget: z.number().int().nonnegative().optional(),
  maxRunMinutes: z.number().int().positive().optional(),
  allowedAccountIds: z.array(z.string().min(1)).optional(),
  allowedSkillIds: z.array(z.string().min(1)).optional(),
  allowAccountFailover: z.boolean().optional(),
});
export type PolicyRules = z.infer<typeof PolicyRules>;

export type PolicyLevel = 'org' | 'group' | 'agent';

export interface EffectivePolicy {
  workDirSets: string[][];
  maxMode: Mode;
  allowedTools?: string[];
  deniedTools: string[];
  dailyTokenBudget?: number;
  maxRunMinutes?: number;
  allowedAccountIds?: string[];
  allowedSkillIds?: string[];
  allowAccountFailover?: boolean;
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

export function mergePolicies(
  levels: { level: PolicyLevel; policyId: string; version: number; rules: PolicyRules }[],
): EffectivePolicy {
  const sources: EffectivePolicy['sources'] = [];
  const workDirSets: string[][] = [];
  const denied = new Set<string>();
  let maxMode: Mode = 'full-auto';
  let allowedTools: string[] | undefined;
  let allowedAccountIds: string[] | undefined;
  let allowedSkillIds: string[] | undefined;
  let dailyTokenBudget: number | undefined;
  let maxRunMinutes: number | undefined;
  let allowAccountFailover: boolean | undefined;

  for (const { level, policyId, version, rules } of levels) {
    sources.push({ level, policyId, version });
    if (rules.workDirs !== undefined) workDirSets.push([...rules.workDirs]);
    if (rules.maxMode !== undefined) maxMode = minMode(maxMode, rules.maxMode);
    for (const t of rules.deniedTools ?? []) denied.add(t);
    allowedTools = intersect(allowedTools, rules.allowedTools);
    allowedAccountIds = intersect(allowedAccountIds, rules.allowedAccountIds);
    allowedSkillIds = intersect(allowedSkillIds, rules.allowedSkillIds);
    dailyTokenBudget = minNumber(dailyTokenBudget, rules.dailyTokenBudget);
    maxRunMinutes = minNumber(maxRunMinutes, rules.maxRunMinutes);
    // Failover is opt-in and any explicit false wins.
    if (rules.allowAccountFailover === false) allowAccountFailover = false;
    else if (rules.allowAccountFailover === true && allowAccountFailover === undefined)
      allowAccountFailover = true;
  }

  // Unset limits stay absent so the stored snapshot has no undefined members.
  return {
    workDirSets,
    maxMode,
    ...(allowedTools && { allowedTools }),
    deniedTools: [...denied],
    ...(dailyTokenBudget !== undefined && { dailyTokenBudget }),
    ...(maxRunMinutes !== undefined && { maxRunMinutes }),
    ...(allowedAccountIds && { allowedAccountIds }),
    ...(allowedSkillIds && { allowedSkillIds }),
    ...(allowAccountFailover !== undefined && { allowAccountFailover }),
    sources,
  };
}
