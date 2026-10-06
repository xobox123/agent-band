import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunHandle, RunSpec } from '@agent-band/contracts';
import {
  ApiStubAdapter,
  FakeAdapter,
  claudeArgs,
  codexArgs,
  parseClaudeLine,
  parseCodexLine,
  readCodexRateLimits,
  runEnv,
  spawnJsonLines,
} from './index.ts';

const spec: RunSpec = {
  runId: 'run',
  agentId: 'agent',
  prompt: 'hello',
  workDir: process.cwd(),
  mode: 'read-only',
  configDir: '/config',
  gitIdentity: { name: 'Agent', email: 'agent@example.com' },
};
const fixture = (name: string) =>
  readFile(new URL(`../../test/fixtures/${name}.jsonl`, import.meta.url), 'utf8');
const collect = async (handle: RunHandle) => {
  const events = [];
  for await (const event of handle.events) events.push(event);
  return events;
};
const limit = { kind: 'rate_limit', windows: [], limitReached: true, resetsAt: null };

describe('parsers', () => {
  it('normalizes the exact Claude recording without double counting', async () => {
    expect((await fixture('claude-simple')).trim().split('\n').flatMap(parseClaudeLine)).toEqual([
      {
        kind: 'rate_limit',
        windows: [
          { window: '5h', usedPercent: 35, resetsAt: new Date(1791329400000).toISOString() },
          { window: 'weekly', usedPercent: 53, resetsAt: new Date(1791752400000).toISOString() },
        ],
        limitReached: false,
        resetsAt: new Date(1791752400000).toISOString(),
      },
      { kind: 'session', sessionId: '2ab0c42e-3a2f-47be-ae2d-b4dfacbd79cd' },
      { kind: 'text', text: 'OK' },
      {
        kind: 'usage',
        inputTokens: 8960,
        outputTokens: 283,
        cachedTokens: 26729,
        costUsd: 0.022921900000000002,
      },
    ]);
  });
  it('normalizes the exact Codex recording', async () => {
    expect((await fixture('codex-simple')).trim().split('\n').flatMap(parseCodexLine)).toEqual([
      { kind: 'session', sessionId: '01a112a0-7a12-7e91-8bb4-919d1a93b69e' },
      { kind: 'text', text: 'OK' },
      { kind: 'usage', inputTokens: 18684, outputTokens: 5, cachedTokens: 0 },
    ]);
  });
  it('handles Claude tools, empty text and thinking', () => {
    expect(
      parseClaudeLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking' },
              { type: 'text', text: '' },
              { type: 'tool_use', name: 'Read', input: { path: 'a' } },
            ],
          },
        }),
      ),
    ).toEqual([{ kind: 'tool', name: 'Read', input: { path: 'a' } }]);
  });
  it('counts Codex cached and reasoning tokens separately', () => {
    expect(
      parseCodexLine(
        '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":30,"output_tokens":10,"reasoning_output_tokens":5}}',
      ),
    ).toEqual([{ kind: 'usage', inputTokens: 70, cachedTokens: 30, outputTokens: 15 }]);
  });
  it('skips Codex reasoning and preserves tool items', () => {
    expect(parseCodexLine('{"type":"item.completed","item":{"type":"reasoning","text":"private"}}')).toEqual(
      [],
    );
    const item = { type: 'command_execution', command: 'ls' };
    expect(parseCodexLine(JSON.stringify({ type: 'item.completed', item }))).toEqual([
      { kind: 'tool', name: 'command_execution', input: item },
    ]);
  });
  it.each(['usage limit', 'RATE LIMIT', 'limit reached'])('recognizes %s errors', (message) => {
    expect(
      parseClaudeLine(JSON.stringify({ type: 'result', is_error: true, result: message, usage: {} })).slice(
        1,
      ),
    ).toEqual([{ kind: 'error', message }, limit]);
    expect(parseCodexLine(JSON.stringify({ type: 'error', message }))).toEqual([
      { kind: 'error', message },
      limit,
    ]);
    expect(parseCodexLine(JSON.stringify({ type: 'turn.failed', error: { message } }))).toEqual([
      { kind: 'error', message },
      limit,
    ]);
  });
  it('retains ordinary errors without declaring a limit', () => {
    expect(parseCodexLine('{"type":"error","message":"failed"}')).toEqual([
      { kind: 'error', message: 'failed' },
    ]);
  });
  it('rounds Claude utilization and recognizes rejected status', () => {
    expect(
      parseClaudeLine(
        '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","unifiedWindows":{"five_hour":{"utilization":0.12345}}}}',
      ),
    ).toEqual([{ ...limit, windows: [{ window: '5h', usedPercent: 12.3, resetsAt: null }] }]);
  });
  it('ignores unknown events and rejects invalid JSON', () => {
    for (const parse of [parseClaudeLine, parseCodexLine]) {
      expect(parse('{"type":"future"}')).toEqual([]);
      expect(() => parse('bad')).toThrow();
    }
  });
});

describe('arguments and environment', () => {
  it.each([
    ['read-only', 'plan', 'read-only'],
    ['edit', 'acceptEdits', 'workspace-write'],
    ['full-auto', 'bypassPermissions', 'danger-full-access'],
  ] as const)('builds %s arguments', (mode, claudeMode, sandbox) => {
    expect(claudeArgs({ ...spec, mode })).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      claudeMode,
    ]);
    expect(codexArgs({ ...spec, mode })).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-s',
      sandbox,
      'hello',
    ]);
  });
  it('adds optional flags and prefixes the Codex prompt', () => {
    const s = {
      ...spec,
      model: 'model',
      systemPrompt: 'system',
      skillsDir: '/skills',
      allowedTools: ['Read', 'Grep'],
      deniedTools: ['Bash'],
    };
    expect(claudeArgs(s)).toEqual([
      ...claudeArgs(spec),
      '--model',
      'model',
      '--allowedTools',
      'Read,Grep',
      '--disallowedTools',
      'Bash',
      '--append-system-prompt',
      'system',
      '--plugin-dir',
      '/skills',
    ]);
    expect(codexArgs(s)).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-s',
      'read-only',
      '-m',
      'model',
      'system\n\nhello',
    ]);
  });
  it.each(['claude', 'openai'] as const)('sets %s identity and config', (provider) => {
    expect(runEnv(spec, provider)).toEqual({
      [provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: '/config',
      GIT_AUTHOR_NAME: 'Agent',
      GIT_AUTHOR_EMAIL: 'agent@example.com',
      GIT_COMMITTER_NAME: 'Agent',
      GIT_COMMITTER_EMAIL: 'agent@example.com',
      AGENT_BAND_AGENT_ID: 'agent',
      AGENT_BAND_RUN_ID: 'run',
    });
  });
});

describe('process runner', () => {
  const start = (script: string, onExit?: Parameters<typeof spawnJsonLines>[2]) =>
    spawnJsonLines(
      { cmd: process.execPath, args: ['-e', script], cwd: process.cwd(), env: process.env },
      parseCodexLine,
      onExit,
    );
  it('parses split stdout, final lines, stderr, bad JSON and exit status', async () => {
    const h = start(
      `process.stdout.write('{"type":"error",'); setTimeout(() => { process.stdout.write('"message":"oops"}\\nbad\\n{"type":"error","message":"last"}'); process.stderr.write('diagnostic'); process.exitCode = 7; }, 10)`,
    );
    const events = await collect(h);
    expect(events).toContainEqual({ kind: 'error', message: 'oops' });
    expect(events).toContainEqual({ kind: 'error', message: 'last' });
    expect(events).toContainEqual({ kind: 'stderr', text: 'diagnostic' });
    expect(events.filter((e) => e.kind === 'stderr')).toHaveLength(2);
    expect(await h.done).toEqual({ exitCode: 7 });
  });
  it('ignores stdin and appends exit events before completion', async () => {
    const h = start(
      `process.stdin.on('end', () => process.stdout.write('{"type":"error","message":"eof"}')); process.stdin.resume()`,
      () => Promise.resolve([{ kind: 'text', text: 'exit' }]),
    );
    await h.done;
    expect(await collect(h)).toEqual([
      { kind: 'error', message: 'eof' },
      { kind: 'text', text: 'exit' },
    ]);
  });
  it('reports a missing binary once', async () => {
    const cmd = '/nonexistent-agent-band-binary';
    const h = spawnJsonLines({ cmd, args: [], cwd: process.cwd(), env: {} }, parseCodexLine);
    expect(await collect(h)).toEqual([{ kind: 'error', message: `${cmd} not found in PATH` }]);
    expect(await h.done).toEqual({ exitCode: null, error: `${cmd} not found in PATH` });
  });
  it('cancels with SIGTERM', async () => {
    const h = start(
      `setInterval(() => {}, 1000); process.stdout.write('{"type":"thread.started","thread_id":"ready"}\\n')`,
    );
    for await (const event of h.events) {
      expect(event.kind).toBe('session');
      h.cancel();
      h.cancel();
    }
    expect(await h.done).toEqual({ exitCode: null });
    h.cancel();
  });
  it('escalates to SIGKILL after five seconds', async () => {
    const h = start(
      `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('{"type":"thread.started","thread_id":"ready"}\\n')`,
    );
    for await (const event of h.events) {
      expect(event.kind).toBe('session');
      h.cancel();
    }
    expect(await h.done).toEqual({ exitCode: null });
  }, 8000);
  it('settles when the exit hook fails', async () => {
    const h = start('', () => Promise.reject(new Error('hook failed')));
    expect(await collect(h)).toEqual([{ kind: 'error', message: 'hook failed' }]);
    expect(await h.done).toEqual({ exitCode: 0, error: 'hook failed' });
  });
});

describe('rollout reader', () => {
  let home: string | undefined;
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });
  it('finds the matching nested rollout and uses the last token count', async () => {
    home = await mkdtemp(join(tmpdir(), 'runner-'));
    const dir = join(home, 'sessions/2026/10/06');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'rollout-date-thread.jsonl'),
      '{"payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":99}}}}\n' +
        (await fixture('codex-rollout-token-count')) +
        '{"payload":{"type":"other"}}\nbroken',
    );
    await writeFile(join(dir, 'rollout-date-other.jsonl'), '{}');
    expect(await readCodexRateLimits(home, 'thread')).toEqual({
      kind: 'rate_limit',
      windows: [
        { window: '5h', usedPercent: 17, resetsAt: new Date(1791330362000).toISOString() },
        { window: 'weekly', usedPercent: 5, resetsAt: new Date(1791818970000).toISOString() },
      ],
      limitReached: false,
      resetsAt: null,
    });
    expect(await readCodexRateLimits(home, 'missing')).toBeNull();
  });
  it('returns null for a missing home', async () => {
    expect(await readCodexRateLimits('/nonexistent-agent-band-home', 'thread')).toBeNull();
  });
  it('reports exhausted windows', async () => {
    home = await mkdtemp(join(tmpdir(), 'runner-'));
    await mkdir(join(home, 'sessions'));
    await writeFile(
      join(home, 'sessions/rollout-date-thread.jsonl'),
      '{"payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":100,"window_minutes":300,"resets_at":1791330362}}}}',
    );
    expect(await readCodexRateLimits(home, 'thread')).toEqual({
      kind: 'rate_limit',
      windows: [{ window: '5h', usedPercent: 100, resetsAt: new Date(1791330362000).toISOString() }],
      limitReached: true,
      resetsAt: new Date(1791330362000).toISOString(),
    });
  });
});

describe('in-process adapters', () => {
  it('fails API accounts with the specified message', async () => {
    const a = new ApiStubAdapter();
    expect(a.provider).toBe('api');
    const h = a.start(spec);
    expect(await collect(h)).toEqual([{ kind: 'error', message: 'API accounts arrive in a later stage' }]);
    expect((await h.done).exitCode).toBe(1);
  });
  it('records fake runs and replays scripted events and exit code', async () => {
    const a = new FakeAdapter(() => ({ events: [{ kind: 'text', text: 'hi' }], exitCode: 3, delayMs: 1 }));
    const h = a.start(spec);
    expect(await collect(h)).toEqual([{ kind: 'text', text: 'hi' }]);
    expect(await h.done).toEqual({ exitCode: 3 });
    expect(a.started).toEqual([spec]);
  });
  it('cancels a hanging fake', async () => {
    const h = new FakeAdapter(() => ({ events: [], hang: true })).start(spec);
    h.cancel();
    expect(await collect(h)).toEqual([]);
    expect(await h.done).toEqual({ exitCode: null });
  });
});
