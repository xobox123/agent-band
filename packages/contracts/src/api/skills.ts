import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

export const SkillVersionDto = z.object({
  skillId: Id,
  version: z.number().int(),
  contentHash: z.string(),
  sizeBytes: z.number().int(),
  source: z.string(),
  origin: z.string().nullable(),
  createdBy: Id,
  createdAt: IsoDate,
});
export type SkillVersionDto = z.infer<typeof SkillVersionDto>;

export const SkillDto = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  currentVersion: z.number().int(),
  createdBy: Id,
  createdAt: IsoDate,
});
export type SkillDto = z.infer<typeof SkillDto>;
export const SkillList = listOf(SkillDto);

export const SkillDetailDto = SkillDto.extend({ versions: z.array(SkillVersionDto) });
export type SkillDetailDto = z.infer<typeof SkillDetailDto>;

/** Either `files` (path -> base64 content) or `zip` (base64 archive); SKILL.md is required at the root. */
const bundle = {
  files: z.record(z.string(), z.string()).optional(),
  zip: z.string().optional(),
};

export const ImportSkillBody = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().max(2000).optional(),
    ...bundle,
  })
  .strict();
export type ImportSkillBody = z.infer<typeof ImportSkillBody>;

export const NewSkillVersionBody = z
  .object({ description: z.string().max(2000).optional(), ...bundle })
  .strict();
export type NewSkillVersionBody = z.infer<typeof NewSkillVersionBody>;

export const SkillScope = z.union([
  z.object({ org: z.literal(true) }).strict(),
  z.object({ agentGroupId: Id }).strict(),
  z.object({ agentId: Id }).strict(),
]);

export const SkillAssignmentDto = z.object({
  id: Id,
  skillId: Id,
  pinnedVersion: z.number().int().nullable(),
  scope: SkillScope,
  createdBy: Id,
  createdAt: IsoDate,
});
export type SkillAssignmentDto = z.infer<typeof SkillAssignmentDto>;
export const SkillAssignmentList = listOf(SkillAssignmentDto);
export const SkillAssignmentQuery = z.object({ skillId: Id.optional() });

export const AssignSkillBody = z
  .object({ skillId: Id, scope: SkillScope, pinnedVersion: z.number().int().positive().optional() })
  .strict();
export type AssignSkillBody = z.infer<typeof AssignSkillBody>;

export const EffectiveSkillDto = z.object({
  skillId: Id,
  name: z.string(),
  version: z.number().int(),
  contentHash: z.string(),
});
export type EffectiveSkillDto = z.infer<typeof EffectiveSkillDto>;
export const EffectiveSkillList = listOf(EffectiveSkillDto);
