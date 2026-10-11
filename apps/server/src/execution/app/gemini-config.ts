import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MCP_SERVER_NAME, RUN_TOKEN_ENV } from '@agent-band/contracts';
import { GEMINI_UNCHECKABLE_TOOLS, geminiToolNames } from '../../runner/gemini-tools.ts';
import { geminiHookScript } from '../infra/gemini-hook-script.ts';

/**
 * Per-run Gemini system settings: the BeforeTool hook that calls authorize-tool, native excludes for
 * denied tools, and for leader runs the delegation MCP server. The CLI reads it through
 * GEMINI_CLI_SYSTEM_SETTINGS_PATH, so the user's and the project's settings files are never touched.
 */
export function geminiSettings(opts: {
  hookCommand: string;
  deniedTools?: readonly string[] | undefined;
  mcpUrl?: string | undefined;
  apiKey?: boolean | undefined;
}): Record<string, unknown> {
  return {
    hooksConfig: { enabled: true },
    hooks: {
      BeforeTool: [
        {
          matcher: '*',
          hooks: [{ name: 'agent-band-policy', type: 'command', command: opts.hookCommand, timeout: 10000 }],
        },
      ],
    },
    tools: { exclude: [...new Set([...geminiToolNames(opts.deniedTools), ...GEMINI_UNCHECKABLE_TOOLS])] },
    ...(opts.apiKey ? { security: { auth: { selectedType: 'gemini-api-key' } } } : {}),
    ...(opts.mcpUrl
      ? {
          mcpServers: {
            // The token stays in the process environment; Gemini expands $VAR in settings values.
            [MCP_SERVER_NAME]: {
              httpUrl: opts.mcpUrl,
              headers: { Authorization: `Bearer $${RUN_TOKEN_ENV}` },
              timeout: 30000,
              trust: true,
            },
          },
        }
      : {}),
  };
}

/** Writes the hook script and settings of one Gemini run and returns the settings path. */
export async function writeGeminiRunConfig(opts: {
  dir: string;
  runId: string;
  port: number;
  deniedTools?: readonly string[] | undefined;
  mcpUrl?: string | undefined;
  apiKey?: boolean | undefined;
}): Promise<string> {
  const dir = join(opts.dir, 'gemini');
  await mkdir(dir, { recursive: true });
  const script = join(dir, 'authorize-tool.mjs');
  await writeFile(script, geminiHookScript({ port: opts.port, runId: opts.runId }));
  const settings = join(dir, 'settings.json');
  await writeFile(
    settings,
    JSON.stringify(geminiSettings({ ...opts, hookCommand: `node ${JSON.stringify(script)}` }), null, 2),
    { mode: 0o600 },
  );
  return settings;
}
