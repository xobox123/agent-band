import { z } from 'zod';
import { Id, IsoDate, Labels, QueryBool, listOf } from './common.ts';

export const AgentAvatar = z
  .object({ kind: z.enum(['initials', 'color', 'url']), value: z.string().trim().max(2048) })
  .strict()
  .refine(
    (a) => a.kind !== 'url' || z.url({ protocol: /^https$/ }).safeParse(a.value).success,
    'avatar URL must use HTTPS',
  );
export type AgentAvatar = z.infer<typeof AgentAvatar>;

export const AgentRole = z.enum(['leader', 'worker', 'reviewer']);
const GitIdentity = z.object({ name: z.string().trim().min(1).max(120), email: z.email().max(254) }).strict();

export const AgentDto = z.object({
  id: Id,
  orgId: Id,
  slug: z.string(),
  handle: z.string(),
  name: z.string(),
  avatar: AgentAvatar.nullable(),
  accountId: Id,
  model: z.string().nullable(),
  role: AgentRole,
  persona: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  labels: z.array(z.string()),
  groupIds: z.array(Id),
  policyId: Id.nullable(),
  enabled: z.boolean(),
  gitIdentity: z.object({ name: z.string(), email: z.string() }),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type AgentDto = z.infer<typeof AgentDto>;
export const AgentList = listOf(AgentDto);

export const CreateAgentBody = z
  .object({
    slug: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    name: z.string().trim().min(1).max(120),
    avatar: AgentAvatar.optional(),
    accountId: Id,
    model: z.string().trim().max(200).optional(),
    role: AgentRole.default('worker'),
    persona: z.string().trim().max(4000).optional(),
    systemPrompt: z.string().max(32000).optional(),
    labels: Labels.default([]),
    groupIds: z.array(Id).max(64).default([]),
    policyId: Id.optional(),
    enabled: z.boolean().default(true),
    gitIdentity: GitIdentity.optional(),
  })
  .strict();
export type CreateAgentBody = z.input<typeof CreateAgentBody>;

export const UpdateAgentBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    avatar: AgentAvatar.nullable().optional(),
    accountId: Id.optional(),
    model: z.string().trim().max(200).nullable().optional(),
    role: AgentRole.optional(),
    persona: z.string().trim().max(4000).nullable().optional(),
    systemPrompt: z.string().max(32000).nullable().optional(),
    labels: Labels.optional(),
    groupIds: z.array(Id).max(64).optional(),
    policyId: Id.nullable().optional(),
    enabled: z.boolean().optional(),
    gitIdentity: GitIdentity.optional(),
  })
  .strict();
export type UpdateAgentBody = z.input<typeof UpdateAgentBody>;

export const AgentQuery = z.object({
  label: z.string().optional(),
  groupId: Id.optional(),
  enabled: QueryBool.optional(),
});

export const AgentGroupDto = z.object({
  id: Id,
  orgId: Id,
  name: z.string(),
  description: z.string(),
  labels: z.array(z.string()),
  policyId: Id.nullable(),
  agentIds: z.array(Id),
  createdBy: Id,
  createdAt: IsoDate,
});
export type AgentGroupDto = z.infer<typeof AgentGroupDto>;
export const AgentGroupList = listOf(AgentGroupDto);

export const CreateGroupBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    labels: Labels.default([]),
    policyId: Id.optional(),
  })
  .strict();
export type CreateGroupBody = z.input<typeof CreateGroupBody>;

export const UpdateGroupBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    labels: Labels.optional(),
    groupIds: z.array(Id).max(64).optional(),
    policyId: Id.nullable().optional(),
  })
  .strict();
export type UpdateGroupBody = z.input<typeof UpdateGroupBody>;

export const GroupMemberParams = z.object({ id: Id, agentId: Id });
