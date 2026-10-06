import type { NormalizedEvent, ProviderAdapter, RunHandle, RunSpec } from '@agent-band/contracts';
import { parseClaudeLine, parseCodexLine } from './parsers.ts';
import { eventQueue, spawnJsonLines } from './process.ts';
import { readCodexRateLimits } from './rollout.ts';

export function runEnv(s: RunSpec, provider: 'claude' | 'openai'): Record<string, string> {
  return {
    [provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: s.configDir,
    GIT_AUTHOR_NAME: s.gitIdentity.name,
    GIT_AUTHOR_EMAIL: s.gitIdentity.email,
    GIT_COMMITTER_NAME: s.gitIdentity.name,
    GIT_COMMITTER_EMAIL: s.gitIdentity.email,
    AGENT_BAND_AGENT_ID: s.agentId,
    AGENT_BAND_RUN_ID: s.runId,
  };
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
    ['--allowedTools', s.allowedTools?.join(',')],
    ['--disallowedTools', s.deniedTools?.join(',')],
    ['--append-system-prompt', s.systemPrompt],
    ['--plugin-dir', s.skillsDir],
  ])
    if (value !== undefined && flag !== undefined) args.push(flag, value);
  return args;
}
export function codexArgs(s: RunSpec): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-s',
    { 'read-only': 'read-only', edit: 'workspace-write', 'full-auto': 'danger-full-access' }[s.mode],
    ...(s.model !== undefined ? ['-m', s.model] : []),
    s.systemPrompt !== undefined ? `${s.systemPrompt}\n\n${s.prompt}` : s.prompt,
  ];
}
export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude';
  start(s: RunSpec): RunHandle {
    return spawnJsonLines(
      {
        cmd: 'claude',
        args: claudeArgs(s),
        cwd: s.workDir,
        env: { ...process.env, ...runEnv(s, this.provider) },
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
        cmd: 'codex',
        args: codexArgs(s),
        cwd: s.workDir,
        env: { ...process.env, ...runEnv(s, this.provider) },
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
