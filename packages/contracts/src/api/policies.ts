import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

export const Mode = z.enum(['read-only', 'edit', 'full-auto']);

const absolutePath = z
  .string()
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'must be an absolute path');

export const PermissionRisk = z.enum(['low', 'medium', 'high']);
export type PermissionRisk = z.infer<typeof PermissionRisk>;

/** Built-in sets of tool rules that run without asking. Claude tool rule syntax. */
export const PERMISSION_PRESETS = [
  {
    id: 'web-read',
    label: 'Web read',
    description: 'Search the web and fetch pages (WebSearch, WebFetch).',
    tools: ['WebSearch', 'WebFetch'],
    risk: 'low',
  },
  {
    id: 'edit-files',
    label: 'Edit files',
    description: 'Create and change files (Edit, Write, MultiEdit, NotebookEdit).',
    tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    risk: 'medium',
  },
  {
    id: 'shell-git',
    label: 'Shell: git',
    description: 'Run git commands.',
    tools: ['Bash(git:*)'],
    risk: 'medium',
  },
  {
    id: 'shell-node',
    label: 'Shell: npm and node',
    description: 'Run npm, npx and node commands.',
    tools: ['Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)'],
    risk: 'medium',
  },
  {
    id: 'shell-curl',
    label: 'Network via curl',
    description: 'Run curl commands.',
    tools: ['Bash(curl:*)'],
    risk: 'medium',
  },
  {
    id: 'shell-any',
    label: 'Shell: any command',
    description: 'Run any shell command without asking. Gives the agent full control of the machine.',
    tools: ['Bash'],
    risk: 'high',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  tools: readonly string[];
  risk: PermissionRisk;
}[];
export type PermissionPresetId = (typeof PERMISSION_PRESETS)[number]['id'];
export const PermissionPresetIdSchema = z.enum(
  PERMISSION_PRESETS.map((p) => p.id) as [PermissionPresetId, ...PermissionPresetId[]],
);

/** Expands preset ids to tool rules; unknown ids are ignored. */
export function expandPresets(ids: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const preset of PERMISSION_PRESETS) {
    if (ids?.includes(preset.id)) for (const t of preset.tools) out.add(t);
  }
  return [...out];
}

function ruleName(rule: string): string {
  const i = rule.indexOf('(');
  return i < 0 ? rule : rule.slice(0, i);
}
function nameMatches(pattern: string, tool: string): boolean {
  return pattern.endsWith('*') ? tool.startsWith(pattern.slice(0, -1)) : pattern === tool;
}

/**
 * Effective pre-approved rules: presets plus custom rules, minus anything a bare denied tool
 * (or an identical denied rule) covers, limited to tools the allowlist permits when it is set.
 */
export function resolvePreApproved(p: {
  presets?: readonly string[] | undefined;
  preApprovedTools?: readonly string[] | undefined;
  deniedTools?: readonly string[] | undefined;
  allowedTools?: readonly string[] | undefined;
}): string[] {
  const all = new Set([...expandPresets(p.presets), ...(p.preApprovedTools ?? [])]);
  return [...all].filter((rule) => {
    const name = ruleName(rule);
    for (const d of p.deniedTools ?? []) {
      if (d === rule) return false;
      if (!d.includes('(') && nameMatches(d, name)) return false;
    }
    return !p.allowedTools || p.allowedTools.some((a) => nameMatches(ruleName(a), name));
  });
}

// Single source of truth for policy rules; the server's policy domain imports this schema.
export const PolicyRules = z.strictObject({
  workDirs: z.array(absolutePath).optional(),
  maxMode: Mode.optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  deniedTools: z.array(z.string().min(1)).optional(),
  preApprovedTools: z.array(z.string().min(1)).optional(),
  presets: z.array(PermissionPresetIdSchema).optional(),
  dailyTokenBudget: z.number().int().nonnegative().optional(),
  maxRunMinutes: z.number().int().positive().optional(),
  allowedAccountIds: z.array(z.string().min(1)).optional(),
  allowedSkillIds: z.array(z.string().min(1)).optional(),
  allowAccountFailover: z.boolean().optional(),
  canDelegate: z.boolean().optional(),
  delegateTargets: z
    .strictObject({
      agentIds: z.array(z.string().min(1)).optional(),
      labels: z.array(z.string().min(1)).optional(),
      groupIds: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  maxSubtasks: z.number().int().positive().optional(),
  maxRounds: z.number().int().positive().optional(),
  treeTokenBudget: z.number().int().positive().optional(),
});
export type PolicyRules = z.infer<typeof PolicyRules>;

export const PolicyDto = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  currentVersion: z.number().int(),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PolicyDto = z.infer<typeof PolicyDto>;
export const PolicyList = listOf(PolicyDto);

export const PolicyVersionDto = z.object({
  policyId: Id,
  version: z.number().int(),
  rules: PolicyRules,
  createdBy: Id,
  createdAt: IsoDate,
});
export type PolicyVersionDto = z.infer<typeof PolicyVersionDto>;

export const PolicyDetailDto = PolicyDto.extend({
  rules: PolicyRules,
  versions: z.array(PolicyVersionDto),
});
export type PolicyDetailDto = z.infer<typeof PolicyDetailDto>;

export const CreatePolicyBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).default(''),
    rules: PolicyRules,
  })
  .strict();
export type CreatePolicyBody = z.input<typeof CreatePolicyBody>;

/** Name and description change in place; a changed `rules` creates a new version. */
export const UpdatePolicyBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(2000).optional(),
    rules: PolicyRules.optional(),
  })
  .strict();
export type UpdatePolicyBody = z.input<typeof UpdatePolicyBody>;

export const PolicySource = z.object({
  level: z.enum(['org', 'group', 'agent']),
  policyId: Id,
  version: z.number().int(),
});
export const EnforcementCoverage = z.enum([
  'admission',
  'runner',
  'runtime-hook',
  'cli-sandbox',
  'not-enforced',
]);
export const EffectiveRule = z.object({
  value: z.unknown(),
  setBy: PolicySource.nullable(),
  contributors: z.array(PolicySource),
  coverage: EnforcementCoverage,
  coverageDetails: z.array(z.object({ mechanism: EnforcementCoverage, scope: z.string() })),
});
export type EffectiveRule = z.infer<typeof EffectiveRule>;
export const EffectivePolicyDto = z.object({
  rules: z.partialRecord(PolicyRules.keyof(), EffectiveRule),
  workDirSets: z.array(z.array(z.string())),
  maxMode: Mode,
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()),
  preApprovedTools: z.array(z.string()).optional(),
  presets: z.array(z.string()).optional(),
  dailyTokenBudget: z.number().optional(),
  maxRunMinutes: z.number().optional(),
  allowedAccountIds: z.array(z.string()).optional(),
  allowedSkillIds: z.array(z.string()).optional(),
  sources: z.array(
    z.object({ level: z.enum(['org', 'group', 'agent']), policyId: Id, version: z.number().int() }),
  ),
});
export type EffectivePolicyDto = z.infer<typeof EffectivePolicyDto>;
