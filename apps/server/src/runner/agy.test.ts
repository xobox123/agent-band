import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NormalizedEvent, type RunSpec } from '@agent-band/contracts';
import { agyArgs, agyEnv, registerAgyHook } from './adapters.ts';
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

  it('writes the PreToolUse hook and removes the whole .agents dir afterwards', () => {
    const dir = work();
    const restore = registerAgyHook(dir, 'node "/r/hook.mjs"');
    expect(JSON.parse(readFileSync(join(dir, '.agents', 'hooks.json'), 'utf8'))).toEqual({
      'agent-band-policy': {
        PreToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: 'node "/r/hook.mjs"', timeout: 10 }] },
        ],
      },
    });
    restore();
    expect(existsSync(join(dir, '.agents'))).toBe(false);
  });

  it("merges into and then restores the repo's own hooks.json byte for byte", () => {
    const dir = work();
    mkdirSync(join(dir, '.agents'));
    const own = '{"lint":{"PostToolUse":[]}}\n';
    writeFileSync(join(dir, '.agents', 'hooks.json'), own);
    const restore = registerAgyHook(dir, 'node x');
    const merged = JSON.parse(readFileSync(join(dir, '.agents', 'hooks.json'), 'utf8')) as object;
    expect(Object.keys(merged)).toEqual(['lint', 'agent-band-policy']);
    restore();
    expect(readFileSync(join(dir, '.agents', 'hooks.json'), 'utf8')).toBe(own);
  });

  it('keeps a pre-existing .agents dir that had no hooks.json', () => {
    const dir = work();
    mkdirSync(join(dir, '.agents'));
    writeFileSync(join(dir, '.agents', 'rules.json'), '{}');
    registerAgyHook(dir, 'node x')();
    expect(existsSync(join(dir, '.agents', 'rules.json'))).toBe(true);
    expect(existsSync(join(dir, '.agents', 'hooks.json'))).toBe(false);
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
