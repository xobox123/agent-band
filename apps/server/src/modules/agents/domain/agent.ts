import { z } from 'zod';
import { invalid } from '../../../platform/errors.ts';

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const labelsSchema = z
  .array(z.string().trim().min(1).max(63))
  .max(32)
  .refine((l) => new Set(l).size === l.length, 'labels must be unique');

const gitIdentitySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
  })
  .strict();

const optText = (max: number) => z.string().trim().max(max);
const uuid = z.uuid();

export const createAgentSchema = z
  .object({
    slug: z.string().regex(SLUG_RE, 'slug must be 1-63 lowercase letters, digits or hyphens'),
    name: z.string().trim().min(1).max(120),
    avatar: optText(2048).optional(),
    accountId: uuid,
    model: optText(200).optional(),
    role: z.enum(['leader', 'worker', 'reviewer']).default('worker'),
    persona: optText(4000).optional(),
    systemPrompt: z.string().max(32000).optional(),
    labels: labelsSchema.default([]),
    groupIds: z.array(uuid).max(64).default([]),
    policyId: uuid.optional(),
    enabled: z.boolean().default(true),
    gitIdentity: gitIdentitySchema.optional(),
  })
  .strict();

export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    avatar: optText(2048).nullable().optional(),
    accountId: uuid.optional(),
    model: optText(200).nullable().optional(),
    role: z.enum(['leader', 'worker', 'reviewer']).optional(),
    persona: optText(4000).nullable().optional(),
    systemPrompt: z.string().max(32000).nullable().optional(),
    labels: labelsSchema.optional(),
    policyId: uuid.nullable().optional(),
    enabled: z.boolean().optional(),
    gitIdentity: gitIdentitySchema.optional(),
  })
  .strict();

const groupBase = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  labels: labelsSchema,
  policyId: uuid.nullable(),
};

export const createGroupSchema = z
  .object({
    name: groupBase.name,
    description: groupBase.description.default(''),
    labels: groupBase.labels.default([]),
    policyId: uuid.optional(),
  })
  .strict();

export const updateGroupSchema = z
  .object({
    name: groupBase.name.optional(),
    description: groupBase.description.optional(),
    labels: groupBase.labels.optional(),
    policyId: groupBase.policyId.optional(),
  })
  .strict();

export type CreateAgentInput = z.input<typeof createAgentSchema>;
export type UpdateAgentInput = z.input<typeof updateAgentSchema>;
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

export function defaultGitIdentity(name: string, slug: string): { name: string; email: string } {
  return { name: `${name} (agent-band)`, email: `${slug}@agents.agent-band.local` };
}

export const agentHandle = (slug: string): string => `agent:${slug}`;

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw invalid(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}
