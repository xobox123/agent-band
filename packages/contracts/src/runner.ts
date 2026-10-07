import { z } from 'zod';

export const NormalizedEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({
    kind: z.literal('tool'),
    name: z.string(),
    input: z.unknown().optional(),
    toolUseId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool_decision'),
    decision: z.enum(['allow', 'deny']),
    reason: z.string(),
    toolUseId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('usage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedTokens: z.number(),
    costUsd: z.number().optional(),
  }),
  z.object({
    kind: z.literal('rate_limit'),
    windows: z.array(
      z.object({
        window: z.enum(['5h', 'weekly']),
        usedPercent: z.number(),
        resetsAt: z.string().nullable(),
      }),
    ),
    limitReached: z.boolean(),
    resetsAt: z.string().nullable(),
  }),
  z.object({ kind: z.literal('error'), message: z.string() }),
  z.object({ kind: z.literal('stderr'), text: z.string() }),
  z.object({ kind: z.literal('session'), sessionId: z.string() }),
]);
export type NormalizedEvent = z.infer<typeof NormalizedEvent>;
export const RunSpec = z.object({
  runId: z.string(),
  prompt: z.string(),
  workDir: z.string(),
  mode: z.enum(['read-only', 'edit', 'full-auto']),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  configDir: z.string(),
  skillsDir: z.string().optional(),
  /** Claude MCP config file attached to goal (leader) runs. */
  mcpConfigPath: z.string().optional(),
  /** Delegation MCP server URL for Codex leader runs; the run token is passed through env only. */
  mcpServerUrl: z.string().optional(),
  /** Claude session to resume on a leader continuation turn. */
  resumeSessionId: z.string().optional(),
  gitIdentity: z.object({ name: z.string(), email: z.string() }),
  agentId: z.string(),
  env: z.record(z.string(), z.string()).optional(),
});
export type RunSpec = z.infer<typeof RunSpec>;
export interface RunHandle {
  events: AsyncIterable<NormalizedEvent>;
  done: Promise<{ exitCode: number | null; error?: string }>;
  cancel(): void;
}
export interface ProviderAdapter {
  readonly provider: 'claude' | 'openai' | 'api';
  start(spec: RunSpec): RunHandle;
}
