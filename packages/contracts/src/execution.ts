import { z } from 'zod';

export const AuthorizeToolRequest = z.object({
  runId: z.uuid(),
  toolName: z.string().min(1),
  toolInput: z.unknown().optional(),
  toolUseId: z.string().optional(),
});
export type AuthorizeToolRequest = z.infer<typeof AuthorizeToolRequest>;

export const AuthorizeToolResponse = z.object({
  decision: z.enum(['allow', 'deny']),
  reason: z.string(),
});
export type AuthorizeToolResponse = z.infer<typeof AuthorizeToolResponse>;

export const RUN_TOKEN_HEADER = 'x-agent-band-run-token';
