import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MCP_SERVER_NAME,
  MCP_TOOLS_ALLOW,
  RUN_TOKEN_ENV,
  type NormalizedEvent,
  type ProviderAdapter,
  type RunHandle,
  RunSpec,
} from '@agent-band/contracts';
import { registerAgyHook } from './agy-hook.ts';
import { cliCommand, missingCliMessage, withCliPath } from './cli-locator.ts';
import { geminiAllowedTools } from './gemini-tools.ts';
import { parseAgyLine, parseClaudeLine, parseCodexLine, parseGeminiLine } from './parsers.ts';
import { eventQueue, spawnJsonLines } from './process.ts';
import { readCodexRateLimits } from './rollout.ts';

const HOME_KEY = { claude: 'CLAUDE_CONFIG_DIR', openai: 'CODEX_HOME', gemini: 'GEMINI_CLI_HOME' } as const;

/** Variables every run gets: the agent's git identity and ids, on top of the spec's own env. */
function identityEnv(s: RunSpec): Record<string, string> {
  return {
    ...s.env,
    GIT_AUTHOR_NAME: s.gitIdentity.name,
    GIT_AUTHOR_EMAIL: s.gitIdentity.email,
    GIT_COMMITTER_NAME: s.gitIdentity.name,
    GIT_COMMITTER_EMAIL: s.gitIdentity.email,
    AGENT_BAND_AGENT_ID: s.agentId,
    AGENT_BAND_RUN_ID: s.runId,
  };
}

export function runEnv(s: RunSpec, provider: keyof typeof HOME_KEY): Record<string, string> {
  const key = HOME_KEY[provider];
  // Setting the variable even to the default dir changes where the CLI looks up its login
  // (Claude on macOS keys the Keychain entry by it), so the default dir is left implicit.
  // Gemini's variable names the home root that contains `.gemini`, so the root is a default too.
  const dir = resolve(s.configDir);
  const defaults = {
    claude: [join(homedir(), '.claude')],
    openai: [join(homedir(), '.codex')],
    gemini: [join(homedir(), '.gemini'), homedir()],
  }[provider];
  const isDefault = defaults.includes(dir);
  return { ...identityEnv(s), ...(isDefault ? {} : { [key]: s.configDir }) };
}
function allowedToolsArg(s: RunSpec): string | undefined {
  const tools = [
    ...new Set([
      ...(s.allowedTools ?? []),
      ...(s.preApprovedTools ?? []),
      ...(s.mcpConfigPath !== undefined ? [MCP_TOOLS_ALLOW] : []),
    ]),
  ];
  return tools.length > 0 ? tools.join(',') : undefined;
}
export function claudeArgs(s: RunSpec): string[] {
  const args = [
    '-p',
    s.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    { 'read-only': 'plan', edit: 'acceptEdits', 'full-auto': 'bypassPermissions' }[s.mode],
  ];
  for (const [flag, value] of [
    ['--model', s.model],
    ['--allowedTools', allowedToolsArg(s)],
    ['--disallowedTools', s.deniedTools?.join(',')],
    ['--append-system-prompt', s.systemPrompt],
    ['--plugin-dir', s.skillsDir],
    ['--mcp-config', s.mcpConfigPath],
    ['--resume', s.resumeSessionId],
  ])
    if (value !== undefined && flag !== undefined) args.push(flag, value);
  // Only the per-run delegation server is loaded; user and project MCP servers are ignored.
  if (s.mcpConfigPath !== undefined) args.push('--strict-mcp-config');
  return args;
}
/**
 * Per-run config for the delegation server, passed with -c so the user's config.toml is never
 * written. The token is read by Codex from the env var named here and never appears in argv.
 * default_tools_approval_mode=approve keeps the server's tools from being rejected in headless mode.
 */
export function codexMcpOverrides(url: string): string[] {
  const key = `mcp_servers.${MCP_SERVER_NAME}`;
  return [
    `${key}.url=${JSON.stringify(url)}`,
    `${key}.bearer_token_env_var=${JSON.stringify(RUN_TOKEN_ENV)}`,
    `${key}.default_tools_approval_mode="approve"`,
    `${key}.required=true`,
    `${key}.startup_timeout_sec=30`,
  ].flatMap((v) => ['-c', v]);
}
const NETWORK_RULES = new Set(['WebSearch', 'WebFetch', 'Bash']);

/** Codex has no per-tool rules; web, curl and unrestricted shell rules map to sandbox network access. */
export function needsCodexNetwork(rules: readonly string[] | undefined): boolean {
  return (rules ?? []).some((r) => NETWORK_RULES.has(r) || r.startsWith('Bash(curl:'));
}
export function codexArgs(s: RunSpec): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    ...(s.mcpServerUrl !== undefined ? codexMcpOverrides(s.mcpServerUrl) : []),
    '-s',
    { 'read-only': 'read-only', edit: 'workspace-write', 'full-auto': 'danger-full-access' }[s.mode],
    ...(s.mode === 'edit' && needsCodexNetwork(s.preApprovedTools)
      ? ['-c', 'sandbox_workspace_write.network_access=true']
      : []),
    ...(s.model !== undefined ? ['-m', s.model] : []),
    s.systemPrompt !== undefined ? `${s.systemPrompt}\n\n${s.prompt}` : s.prompt,
  ];
}
/** Variables that would silently switch a Gemini run to another auth route than the account's. */
const GEMINI_AUTH_ENV = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_GCA',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

/** `auto` is the CLI's own routing: no -m flag. */
const GEMINI_AUTO_MODELS = new Set(['auto', 'default']);

export function geminiArgs(s: RunSpec): string[] {
  const prompt = s.systemPrompt !== undefined ? `${s.systemPrompt}\n\n${s.prompt}` : s.prompt;
  const args = [
    // The = form keeps a prompt that starts with a dash from being read as a flag.
    `--prompt=${prompt}`,
    '--output-format',
    'stream-json',
    '--approval-mode',
    { 'read-only': 'plan', edit: 'auto_edit', 'full-auto': 'yolo' }[s.mode],
  ];
  if (s.model !== undefined && !GEMINI_AUTO_MODELS.has(s.model)) args.push('-m', s.model);
  // --allowed-tools auto-approves; it is not an exclusive allowlist (the BeforeTool hook is).
  for (const tool of geminiAllowedTools(s.preApprovedTools)) args.push('--allowed-tools', tool);
  return args;
}

/** Gemini env: the account home, the per-run settings, and no inherited key that changes the auth route. */
export function geminiEnv(s: RunSpec): Record<string, string | undefined> {
  return {
    ...process.env,
    ...Object.fromEntries(GEMINI_AUTH_ENV.map((name) => [name, undefined])),
    ...runEnv(s, 'gemini'),
    ...(s.geminiSettingsPath !== undefined ? { GEMINI_CLI_SYSTEM_SETTINGS_PATH: s.geminiSettingsPath } : {}),
  };
}
export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'gemini';
  start(s: RunSpec): RunHandle {
    return spawnJsonLines(
      {
        cmd: cliCommand('gemini'),
        args: geminiArgs(s),
        cwd: s.workDir,
        env: withCliPath('gemini', geminiEnv(s)),
        missingMessage: missingCliMessage('gemini'),
      },
      (line) => parseGeminiLine(line),
    );
  }
}
/** Variables that would switch an Antigravity run from the machine's Google login to an API key. */
const AGY_AUTH_ENV = ['GEMINI_API_KEY', 'ANTIGRAVITY_API_KEY', 'GOOGLE_GEMINI_BASE_URL'];

/**
 * agy has no config-dir variable: its login sits in the OS keyring and its settings under ~/.gemini,
 * so every run uses the machine's one default account.
 */
export function agyArgs(s: RunSpec): string[] {
  const prompt = s.systemPrompt !== undefined ? `${s.systemPrompt}\n\n${s.prompt}` : s.prompt;
  const args = [
    // The = form keeps a prompt that starts with a dash from being read as a flag.
    `--print=${prompt}`,
    '--output-format',
    'stream-json',
    ...(s.mode === 'full-auto'
      ? ['--dangerously-skip-permissions']
      : ['--mode', s.mode === 'read-only' ? 'plan' : 'accept-edits']),
  ];
  if (s.model !== undefined && !GEMINI_AUTO_MODELS.has(s.model)) args.push('--model', s.model);
  if (s.maxRunMinutes !== undefined) args.push('--print-timeout', `${s.maxRunMinutes}m`);
  if (s.resumeSessionId !== undefined) args.push('--conversation', s.resumeSessionId);
  return args;
}

export function agyEnv(s: RunSpec): Record<string, string | undefined> {
  return {
    ...process.env,
    ...Object.fromEntries(AGY_AUTH_ENV.map((name) => [name, undefined])),
    ...identityEnv(s),
  };
}

export class AntigravityAdapter implements ProviderAdapter {
  readonly provider = 'antigravity';
  start(s: RunSpec): RunHandle {
    let restore: (() => void) | undefined;
    try {
      if (s.antigravityHookCommand && s.antigravityHookState) {
        restore = registerAgyHook(s.workDir, s.antigravityHookCommand, s.antigravityHookState);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const queue = eventQueue();
      queue.push({ kind: 'error', message });
      queue.end();
      return { events: queue.events, done: Promise.resolve({ exitCode: 1, error: message }), cancel() {} };
    }
    return spawnJsonLines(
      {
        cmd: cliCommand('agy'),
        args: agyArgs(s),
        cwd: s.workDir,
        env: withCliPath('agy', agyEnv(s)),
        missingMessage: missingCliMessage('agy'),
      },
      (line) => parseAgyLine(line),
      () => {
        restore?.();
        return Promise.resolve([]);
      },
    );
  }
}
export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude';
  start(s: RunSpec): RunHandle {
    return spawnJsonLines(
      {
        cmd: cliCommand('claude'),
        args: claudeArgs(s),
        cwd: s.workDir,
        env: withCliPath('claude', { ...process.env, ...runEnv(s, this.provider) }),
        missingMessage: missingCliMessage('claude'),
      },
      parseClaudeLine,
    );
  }
}
export class CodexAdapter implements ProviderAdapter {
  readonly provider = 'openai';
  start(s: RunSpec): RunHandle {
    let threadId: string | undefined;
    return spawnJsonLines(
      {
        cmd: cliCommand('codex'),
        args: codexArgs(s),
        cwd: s.workDir,
        env: withCliPath('codex', { ...process.env, ...runEnv(s, this.provider) }),
        missingMessage: missingCliMessage('codex'),
      },
      (line) => {
        const events = parseCodexLine(line);
        for (const event of events) if (event.kind === 'session') threadId = event.sessionId;
        return events;
      },
      async () => {
        const event = threadId ? await readCodexRateLimits(s.configDir, threadId) : null;
        return event ? [event] : [];
      },
    );
  }
}
export class ApiStubAdapter implements ProviderAdapter {
  readonly provider = 'api';
  start(s: RunSpec): RunHandle;
  start(): RunHandle {
    const message = 'API accounts arrive in a later stage';
    const queue = eventQueue();
    queue.push({ kind: 'error', message });
    queue.end();
    return { events: queue.events, done: Promise.resolve({ exitCode: 1, error: message }), cancel() {} };
  }
}
export class FakeAdapter implements ProviderAdapter {
  readonly provider = 'claude';
  readonly started: RunSpec[] = [];
  constructor(
    private readonly script: (s: RunSpec) => {
      events: NormalizedEvent[];
      exitCode?: number;
      delayMs?: number;
      hang?: boolean;
    },
  ) {}
  start(s: RunSpec): RunHandle {
    this.started.push(s);
    const script = this.script(s),
      queue = eventQueue();
    let finish!: (result: Awaited<RunHandle['done']>) => void;
    const done = new Promise<Awaited<RunHandle['done']>>((resolve) => {
      finish = resolve;
    });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;
    const next = () => {
      if (stopped) return;
      const event = script.events[index++];
      if (event) {
        queue.push(event);
        timer = setTimeout(next, script.delayMs ?? 0);
      } else if (!script.hang) {
        stopped = true;
        queue.end();
        finish({ exitCode: script.exitCode ?? 0 });
      }
    };
    timer = setTimeout(next, script.delayMs ?? 0);
    return {
      events: queue.events,
      done,
      cancel() {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        queue.end();
        finish({ exitCode: null });
      },
    };
  }
}
