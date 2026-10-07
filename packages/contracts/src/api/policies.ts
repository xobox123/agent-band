import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

export const Mode = z.enum(['read-only', 'edit', 'full-auto']);

const absolutePath = z
  .string()
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'must be an absolute path');

// Single source of truth for policy rules; the server's policy domain imports this schema.
export const PolicyRules = z.strictObject({
  workDirs: z.array(absolutePath).optional(),
  maxMode: Mode.optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  deniedTools: z.array(z.string().min(1)).optional(),
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

export const EffectivePolicyDto = z.object({
  workDirSets: z.array(z.array(z.string())),
  maxMode: Mode,
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()),
  dailyTokenBudget: z.number().optional(),
  maxRunMinutes: z.number().optional(),
  allowedAccountIds: z.array(z.string()).optional(),
  allowedSkillIds: z.array(z.string()).optional(),
  sources: z.array(
    z.object({ level: z.enum(['org', 'group', 'agent']), policyId: Id, version: z.number().int() }),
  ),
});
export type EffectivePolicyDto = z.infer<typeof EffectivePolicyDto>;
