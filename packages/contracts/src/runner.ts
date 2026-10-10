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
  /** Effective pre-approved tool rules: granted without asking. */
  preApprovedTools: z.array(z.string()).optional(),
  configDir: z.string(),
  skillsDir: z.string().optional(),
  /** Claude MCP config file attached to goal (leader) runs. */
  mcpConfigPath: z.string().optional(),
  /** Delegation MCP server URL for Codex leader runs; the run token is passed through env only. */
  mcpServerUrl: z.string().optional(),
  /** Gemini per-run system settings file (hooks, MCP); the CLI reads it through GEMINI_CLI_SYSTEM_SETTINGS_PATH. */
  geminiSettingsPath: z.string().optional(),
  /** Antigravity PreToolUse hook command; the adapter registers it in the workspace .agents/hooks.json for the run. */
  antigravityHookCommand: z.string().optional(),
  /** File outside the workspace that holds the sha256 of that hooks.json, checked by the hook before each decision. */
  antigravityHookState: z.string().optional(),
  /** Run time limit; Antigravity gets it as --print-timeout, the worker enforces it for every provider. */
  maxRunMinutes: z.number().positive().optional(),
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
  readonly provider: 'claude' | 'openai' | 'gemini' | 'antigravity' | 'api';
  start(spec: RunSpec): RunHandle;
}
