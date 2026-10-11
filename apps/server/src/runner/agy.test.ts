import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NormalizedEvent, type RunSpec } from '@agent-band/contracts';
import { agyArgs, agyEnv, AntigravityAdapter } from './adapters.ts';
import { registerAgyHook } from './agy-hook.ts';
import { CliLocator, getCliLocator, setCliLocator } from './cli-locator.ts';
import { fakeBins } from './fake-cli.testkit.ts';
import { parseAgyModels } from './models.ts';
import { parseAgyLine } from './parsers.ts';
import { listAgyModels, loginCommand, probeAccount, readAgyUsage, startLogin } from './probe.ts';

const spec: RunSpec = {
  runId: 'run-1',
  agentId: 'agent-1',
  prompt: 'do it',
  workDir: '/work',
  configDir: '/home/x/.gemini',
  mode: 'edit',
  gitIdentity: { name: 'Agent', email: 'agent@example.com' },
  env: { AGENT_BAND_RUN_TOKEN: 'tok' },
};

const fixture = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const lines = (name: string) => fixture(name).trim().split('\n');

let bins: ReturnType<typeof fakeBins>;
beforeAll(() => {
  bins = fakeBins();
});
afterEach(() => {
  delete process.env.FAKE_MODE;
});

describe('parseAgyLine (stream captured from a real agy 1.3.1)', () => {
  it('normalizes a plain answer: session, text, usage', () => {
    const events = lines('agy-stream-ok.fixture.jsonl').flatMap((l) => parseAgyLine(l));
    for (const e of events) NormalizedEvent.parse(e);
    expect(events).toEqual([
      { kind: 'session', sessionId: 'b95ea074-cc97-4e74-aa6e-81c91b386475' },
      { kind: 'text', text: 'OK' },
      { kind: 'text', text: '\n' },
      { kind: 'usage', inputTokens: 13221, outputTokens: 678, cachedTokens: 0 },
    ]);
  });

  it('reports a tool call once and its failure and the auto-denial as stderr', () => {
    const events = lines('agy-stream-denied.fixture.jsonl').flatMap((l) => {
      try {
        return parseAgyLine(l);
      } catch {
        return []; // the plain-text jetski notice: the process layer keeps it as stderr
      }
    });
    for (const e of events) NormalizedEvent.parse(e);
    expect(events.filter((e) => e.kind === 'tool')).toEqual([
      {
        kind: 'tool',
        name: 'run_command',
        input: { CommandLine: 'echo hi' },
        toolUseId: 'f6e2afab-c7a3-4258-8e76-45a7170c2b25:2',
      },
    ]);
    expect(events.filter((e) => e.kind === 'stderr').map((e) => (e as { text: string }).text)).toEqual([
      'tool run_command failed: permission check failed for unsandboxed "echo hi": user denied permission to run command:',
      'agy auto-denied permissions that headless mode cannot ask for: command',
    ]);
    expect(events.some((e) => e.kind === 'error')).toBe(false);
  });

  it('never reports cost, ignores unknown events and throws on non-JSON lines', () => {
    expect(parseAgyLine('{"event":"something_new"}')).toEqual([]);
    expect(parseAgyLine('{"event":"step_update","step_update":{"step_type":"user_input"}}')).toEqual([]);
    expect(() => parseAgyLine('jetski: no output produced')).toThrow();
  });

  it('subtracts cached tokens from input and keeps thinking inside output', () => {
    const line = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_type: 'agent_response',
        state: 'DONE',
        usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 15, cache_read_tokens: 40 },
      },
    });
    expect(parseAgyLine(line)).toEqual([
      { kind: 'usage', inputTokens: 60, outputTokens: 20, cachedTokens: 40 },
    ]);
  });

  it('does not count the result usage, which is cumulative over a resumed conversation', () => {
    const line = JSON.stringify({
      event: 'result',
      result: { status: 'SUCCESS', usage: { input_tokens: 28352, output_tokens: 679 } },
    });
    expect(parseAgyLine(line)).toEqual([]);
  });
});

describe('agy quota errors', () => {
  const now = Date.parse('2026-10-07T10:00:00.000Z');
  const failed = (error: string) =>
    JSON.stringify({ event: 'result', result: { status: 'ERROR', error, conversation_id: 'c' } });

  it('turns a quota or credits error into error plus rate_limit', () => {
    for (const message of [
      'Your AI credits balance is too low to continue.',
      'RESOURCE_EXHAUSTED: quota exceeded for model gemini-3.1-pro-high, resets in 3h24m5s',
    ]) {
      const events = parseAgyLine(failed(message), now);
      expect(events.map((e) => e.kind)).toEqual(['error', 'rate_limit']);
      for (const e of events) NormalizedEvent.parse(e);
    }
    expect(parseAgyLine(failed('quota, resets in 1h'), now)[1]).toEqual({
      kind: 'rate_limit',
      windows: [],
      limitReached: true,
      resetsAt: '2026-10-07T11:00:00.000Z',
    });
  });

  it('keeps other failures as a plain error', () => {
    expect(parseAgyLine(failed('invalid model selection'), now)).toEqual([
      { kind: 'error', message: 'invalid model selection' },
    ]);
    expect(parseAgyLine(JSON.stringify({ event: 'result', result: { status: 'ERROR' } }), now)).toEqual([
      { kind: 'error', message: 'Antigravity run failed' },
    ]);
  });
});

describe('agyArgs', () => {
  it('maps modes to --mode plan, --mode accept-edits and --dangerously-skip-permissions', () => {
    expect(agyArgs({ ...spec, mode: 'read-only' })).toEqual([
      '--print=do it',
      '--output-format',
      'stream-json',
      '--mode',
      'plan',
    ]);
    expect(agyArgs(spec).slice(-2)).toEqual(['--mode', 'accept-edits']);
    const full = agyArgs({ ...spec, mode: 'full-auto' });
    expect(full).toContain('--dangerously-skip-permissions');
    expect(full).not.toContain('--mode');
  });

  it('passes model, timeout and resume, prefixes the system prompt and never passes secrets', () => {
    const args = agyArgs({
      ...spec,
      model: 'gemini-3.8-flash-low',
      maxRunMinutes: 30,
      resumeSessionId: 'conv-1',
      systemPrompt: 'be brief',
    });
    expect(args).toContain('--print=be brief\n\ndo it');
    expect(args.slice(-6)).toEqual([
      '--model',
      'gemini-3.8-flash-low',
      '--print-timeout',
      '30m',
      '--conversation',
      'conv-1',
    ]);
    expect(args.join(' ')).not.toContain('tok');
  });

  it('leaves the model to agy for auto and keeps a dash-leading prompt out of flag position', () => {
    const args = agyArgs({ ...spec, model: 'auto', prompt: '--help' });
    expect(args).not.toContain('--model');
    expect(args[0]).toBe('--print=--help');
  });
});

describe('agyEnv', () => {
  it('keeps the run token and git identity and drops keys that would switch the auth route', () => {
    process.env.GEMINI_API_KEY = 'leak';
    process.env.ANTIGRAVITY_API_KEY = 'leak';
    try {
      const env = agyEnv(spec);
      expect(env.AGENT_BAND_RUN_TOKEN).toBe('tok');
      expect(env.GIT_AUTHOR_EMAIL).toBe('agent@example.com');
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.ANTIGRAVITY_API_KEY).toBeUndefined();
      expect(Object.keys(env)).not.toContain('GEMINI_CLI_HOME');
    } finally {
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTIGRAVITY_API_KEY;
    }
  });
});

describe('registerAgyHook', () => {
  const work = () => mkdtempSync(join(tmpdir(), 'agy-work-'));

  const state = () => join(mkdtempSync(join(tmpdir(), 'agy-state-')), 'hooks.sha256');
  const hooksOf = (dir: string) => join(dir, '.agents', 'hooks.json');
  const repo = () => {
    const dir = work();
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'a@b.c');
    git(dir, 'config', 'user.name', 'a');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'init');
    return dir;
  };
  function git(dir: string, ...args: string[]): string {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  }

  it('writes a read-only PreToolUse hook with its hash and removes the whole .agents dir afterwards', () => {
    const dir = work();
    const stateFile = state();
    const restore = registerAgyHook(dir, 'node "/r/hook.mjs"', stateFile);
    const text = readFileSync(hooksOf(dir), 'utf8');
    expect(JSON.parse(text)).toEqual({
      'agent-band-policy': {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: `node "/r/hook.mjs" ${JSON.stringify(hooksOf(dir))} ${JSON.stringify(stateFile)}`,
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
    expect(statSync(hooksOf(dir)).mode & 0o222).toBe(0);
    expect(readFileSync(stateFile, 'utf8')).toBe(createHash('sha256').update(text).digest('hex'));
    restore();
    expect(existsSync(join(dir, '.agents'))).toBe(false);
    expect(existsSync(stateFile)).toBe(false);
  });

  it("merges into and then restores the workspace's own untracked hooks.json byte for byte", () => {
    const dir = work();
    mkdirSync(join(dir, '.agents'));
    const own = '{\n  "lint": {\n    "PostToolUse": []\n  }\n}\n';
    writeFileSync(hooksOf(dir), own);
    const restore = registerAgyHook(dir, 'node x', state());
    expect(Object.keys(JSON.parse(readFileSync(hooksOf(dir), 'utf8')) as object)).toEqual([
      'lint',
      'agent-band-policy',
    ]);
    restore();
    expect(JSON.parse(readFileSync(hooksOf(dir), 'utf8'))).toEqual({ lint: { PostToolUse: [] } });
  });

  it('keeps a pre-existing .agents dir that had no hooks.json', () => {
    const dir = work();
    mkdirSync(join(dir, '.agents'));
    writeFileSync(join(dir, '.agents', 'rules.json'), '{}');
    registerAgyHook(dir, 'node x', state())();
    expect(existsSync(join(dir, '.agents', 'rules.json'))).toBe(true);
    expect(existsSync(hooksOf(dir))).toBe(false);
  });

  it('keeps git status clean during the run, even after git add -A, and restores info/exclude', () => {
    const dir = repo();
    const exclude = join(dir, '.git', 'info', 'exclude');
    const before = readFileSync(exclude, 'utf8');
    const restore = registerAgyHook(dir, 'node x', state());
    expect(git(dir, 'status', '--porcelain')).toBe('');
    git(dir, 'add', '-A');
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('');
    restore();
    expect(readFileSync(exclude, 'utf8')).toBe(before);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('refuses to start when the repository tracks .agents/hooks.json', () => {
    const dir = repo();
    mkdirSync(join(dir, '.agents'));
    writeFileSync(hooksOf(dir), '{}');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'hooks');
    expect(() => registerAgyHook(dir, 'node x', state())).toThrow(/tracks \.agents\/hooks\.json/);
    expect(readFileSync(hooksOf(dir), 'utf8')).toBe('{}');
  });

  it('refuses a second run in the same workspace until the first one is restored', () => {
    const dir = work();
    const restore = registerAgyHook(dir, 'node x', state());
    expect(() => registerAgyHook(dir, 'node y', state())).toThrow(/another Antigravity run/);
    restore();
    registerAgyHook(dir, 'node y', state())();
  });

  it('removes the stale entry of a crashed run (its script is gone) but refuses a live one', () => {
    const dir = work();
    const scripts = mkdtempSync(join(tmpdir(), 'agy-script-'));
    mkdirSync(join(dir, '.agents'));
    const entry = (script: string) => ({
      'agent-band-policy': {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${script}" x y` }] }],
      },
      lint: {},
    });
    writeFileSync(hooksOf(dir), JSON.stringify(entry(join(scripts, 'gone.mjs'))));
    const restore = registerAgyHook(dir, 'node x', state());
    restore();
    expect(JSON.parse(readFileSync(hooksOf(dir), 'utf8'))).toEqual({ lint: {} });
    const live = join(scripts, 'live.mjs');
    writeFileSync(live, '');
    writeFileSync(hooksOf(dir), JSON.stringify(entry(live)));
    expect(() => registerAgyHook(dir, 'node x', state())).toThrow(/another Antigravity run/);
  });
});

describe('AntigravityAdapter hook lifecycle', () => {
  const base = (workDir: string): RunSpec => ({
    ...spec,
    workDir,
    antigravityHookCommand: 'node "/r/hook.mjs"',
    antigravityHookState: join(mkdtempSync(join(tmpdir(), 'agy-state-')), 'hooks.sha256'),
  });
  const originalLocator = getCliLocator();
  const originalPath = process.env.PATH;
  const bin = async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'agy-bin-')), 'agy');
    writeFileSync(path, '#!/bin/sh\n[ "$1" = "--version" ] && echo 1.0.0 && exit 0\nsleep 30\n', {
      mode: 0o755,
    });
    const locator = new CliLocator({ overrides: { agy: path }, shell: '/nonexistent', knownDirs: [] });
    await locator.detectAll();
    setCliLocator(locator);
  };
  afterEach(() => {
    setCliLocator(originalLocator);
    process.env.PATH = originalPath;
  });

  it('removes the hook file after a missing CLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-work-'));
    setCliLocator(new CliLocator({ overrides: {}, shell: '/nonexistent', knownDirs: [] }));
    process.env.PATH = dir; // nothing named agy there: the spawn fails, never reaching a real CLI
    const handle = new AntigravityAdapter().start(base(dir));
    await handle.done;
    expect(existsSync(join(dir, '.agents'))).toBe(false);
  });

  it('keeps the hook in place while running and removes it after a cancel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-work-'));
    await bin();
    const handle = new AntigravityAdapter().start(base(dir));
    expect(existsSync(join(dir, '.agents', 'hooks.json'))).toBe(true);
    handle.cancel();
    await handle.done;
    expect(existsSync(join(dir, '.agents'))).toBe(false);
  });

  it('fails the run instead of starting when the workspace is not free', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-work-'));
    await bin();
    const first = new AntigravityAdapter().start(base(dir));
    const second = new AntigravityAdapter().start(base(dir));
    expect((await second.done).error).toMatch(/another Antigravity run/);
    first.cancel();
    await first.done;
  });
});

describe('agy models', () => {
  it('parses the captured `agy models` output and adds an auto entry', () => {
    const items = parseAgyModels(fixture('agy-models.fixture.txt'));
    expect(items).toHaveLength(15);
    expect(items[0]).toMatchObject({ id: 'auto', isDefault: true });
    expect(items[1]).toMatchObject({
      id: 'gemini-3.8-flash-high',
      label: 'Gemini 3.8 Flash (High)',
      source: 'native',
    });
    expect(items.at(-1)?.id).toBe('gpt-oss-120b-medium');
  });

  it('ignores progress lines and lists through the CLI', async () => {
    expect(parseAgyModels('Fetching available models...\n')).toHaveLength(1);
    expect((await listAgyModels({ bins })).map((m) => m.id)).toContain('claude-opus-4-6-thinking');
  });
});

describe('agy account', () => {
  it('has one default account: the login command never carries a config dir', () => {
    expect(loginCommand('antigravity', null)).toBe('agy');
    expect(loginCommand('antigravity', '/data/accounts/x')).toBe('agy');
  });

  it('cannot be started headless: it returns the command', async () => {
    const handle = await startLogin({ provider: 'antigravity', configDir: null }, { bins });
    expect(handle).toMatchObject({ started: false, command: 'agy' });
  });

  it('is logged in when /usage answers, without email or plan', async () => {
    const r = await probeAccount({ provider: 'antigravity', configDir: null }, { bins });
    expect(r).toMatchObject({ loggedIn: true, identity: { authMethod: 'google-oauth' }, loginCommand: null });
    expect(r.identity.email).toBeUndefined();
  });

  it('is not logged in when /usage fails, and reports a missing binary', async () => {
    process.env.FAKE_MODE = 'loggedout';
    const out = await probeAccount({ provider: 'antigravity', configDir: null }, { bins });
    expect(out).toMatchObject({ loggedIn: false, loginCommand: 'agy', error: 'not signed in' });
    const missing = await probeAccount(
      { provider: 'antigravity', configDir: null },
      { bins: { antigravity: { cmd: '/nonexistent/agy' } } },
    );
    expect(missing.loggedIn).toBe(false);
    expect(missing.error).toContain('Antigravity CLI not found');
  });

  it('reads 5h and weekly windows from /usage: the most used group wins, every group is listed', async () => {
    const reading = await readAgyUsage({ bins });
    expect(reading.windows).toEqual([
      { window: 'weekly', usedPercent: 0, resetsAt: '2026-10-14T18:49:44Z' },
      { window: '5h', usedPercent: 0.1, resetsAt: '2026-10-07T23:49:44Z' },
    ]);
    expect(reading.perModel).toHaveLength(4);
    expect(reading.perModel[1]).toEqual({
      label: 'Gemini Models (5h)',
      usedPercent: 0.1,
      resetsAt: '2026-10-07T23:49:44Z',
    });
  });

  it('fails the limits read when not logged in', async () => {
    process.env.FAKE_MODE = 'loggedout';
    await expect(readAgyUsage({ bins })).rejects.toThrow('not signed in');
  });
});
