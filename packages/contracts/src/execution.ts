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
export const RUN_ID_HEADER = 'x-agent-band-run-id';
/** Name of the delegation MCP server as seen by the leader CLI; tools surface as mcp__agent_band__<tool>. */
export const MCP_SERVER_NAME = 'agent_band';
/** Env var the Codex leader run reads its MCP bearer token from. */
export const RUN_TOKEN_ENV = 'AGENT_BAND_RUN_TOKEN';
export const MCP_TOOLS_ALLOW = `mcp__${MCP_SERVER_NAME}__*`;
