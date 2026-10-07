import { z } from 'zod';
import { invalid } from '../../../platform/errors.ts';

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const labelsSchema = z
  .array(z.string().trim().min(1).max(63))
  .max(32)
  .refine((l) => new Set(l).size === l.length, 'labels must be unique');

const uuid = z.uuid();
export {
  CreateAgentBody as createAgentSchema,
  UpdateAgentBody as updateAgentSchema,
} from '@agent-band/contracts';
import {
  CreateAgentBody as createAgentSchema,
  UpdateAgentBody as updateAgentSchema,
} from '@agent-band/contracts';

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
