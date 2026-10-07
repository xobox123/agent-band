import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NormalizedEvent, type RunSpec } from '@agent-band/contracts';
import { geminiArgs, geminiEnv, runEnv } from './adapters.ts';
import { geminiAllowedTools, geminiToolNames } from './gemini-tools.ts';
import { geminiResetsAt, parseGeminiLine } from './parsers.ts';

const spec: RunSpec = {
  runId: 'run-1',
  agentId: 'agent-1',
  prompt: 'do it',
  workDir: '/work',
  configDir: '/data/accounts/gemini-savigo',
  mode: 'edit',
  gitIdentity: { name: 'Agent', email: 'agent@example.com' },
  env: { AGENT_BAND_RUN_TOKEN: 'tok' },
};

describe('parseGeminiLine (synthetic fixture, not captured from a real run)', () => {
  const lines = readFileSync(new URL('./gemini-stream.synthetic.fixture.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n');

  it('normalizes a whole stream and every event matches the contract', () => {
    const events = lines.flatMap((line) => parseGeminiLine(line));
    for (const e of events) NormalizedEvent.parse(e);
    expect(events).toEqual([
      { kind: 'session', sessionId: 'sess-synthetic-1' },
      { kind: 'text', text: 'I will list ' },
      { kind: 'tool', name: 'run_shell_command', input: { command: 'ls' }, toolUseId: 'tool-1' },
      { kind: 'tool', name: 'read_file', input: { file_path: '/nope' }, toolUseId: 'tool-2' },
      { kind: 'stderr', text: 'tool tool-2 failed: File not found' },
      { kind: 'stderr', text: 'warning: Loop detection is disabled' },
      { kind: 'text', text: 'Done.' },
      { kind: 'usage', inputTokens: 400, outputTokens: 300, cachedTokens: 800 },
    ]);
  });

  it('never reports cost and ignores the user echo and unknown events', () => {
    const events = lines.flatMap((line) => parseGeminiLine(line));
    expect(events.some((e) => 'costUsd' in e)).toBe(false);
    expect(parseGeminiLine('{"type":"message","role":"user","content":"x"}')).toEqual([]);
    expect(parseGeminiLine('{"type":"something_new"}')).toEqual([]);
  });

  it('derives uncached input from input_tokens minus cached when `input` is absent', () => {
    expect(
      parseGeminiLine(
        '{"type":"result","status":"success","stats":{"input_tokens":100,"output_tokens":5,"cached":30}}',
      ),
    ).toEqual([{ kind: 'usage', inputTokens: 70, outputTokens: 5, cachedTokens: 30 }]);
  });

  it('throws on a non-JSON line so the process layer keeps it as stderr', () => {
    expect(() => parseGeminiLine('not json')).toThrow();
  });
});

describe('gemini quota errors', () => {
  const now = Date.parse('2026-10-07T10:00:00.000Z');

  it('turns a quota error into error plus rate_limit with the best-known reset', () => {
    const line = JSON.stringify({
      type: 'result',
      status: 'error',
      error: {
        type: 'ApiError',
        message: 'Quota exceeded for model gemini-2.5-pro. Your quota will reset after 3h24m5s.',
      },
      stats: { input_tokens: 1, output_tokens: 0, cached: 0 },
    });
    const events = parseGeminiLine(line, now);
    expect(events.map((e) => e.kind)).toEqual(['usage', 'error', 'rate_limit']);
    expect(events[2]).toEqual({
      kind: 'rate_limit',
      windows: [],
      limitReached: true,
      resetsAt: new Date(now + (3 * 3600 + 24 * 60 + 5) * 1000).toISOString(),
    });
  });

  it('reads retry-in seconds, and gives null when no time is stated', () => {
    expect(geminiResetsAt('429 RESOURCE_EXHAUSTED. Please retry in 34.5s', now)).toBe(
      new Date(now + 35_000).toISOString(),
    );
    const none = parseGeminiLine(
      '{"type":"error","severity":"error","message":"You have exhausted your capacity on this model."}',
      now,
    );
    expect(none[1]).toMatchObject({ kind: 'rate_limit', limitReached: true, resetsAt: null });
  });

  it('does not treat other errors or warnings as rate limits', () => {
    expect(parseGeminiLine('{"type":"error","severity":"error","message":"boom"}')).toEqual([
      { kind: 'error', message: 'boom' },
    ]);
    expect(parseGeminiLine('{"type":"error","severity":"warning","message":"quota is low"}')).toEqual([
      { kind: 'stderr', text: 'warning: quota is low' },
    ]);
  });
});

describe('geminiArgs', () => {
  it('runs headless stream-json with the mapped approval mode', () => {
    expect(geminiArgs(spec)).toEqual([
      '--prompt=do it',
      '--output-format',
      'stream-json',
      '--approval-mode',
      'auto_edit',
    ]);
    const modes = (['read-only', 'edit', 'full-auto'] as const).map(
      (mode) => geminiArgs({ ...spec, mode })[4],
    );
    expect(modes).toEqual(['plan', 'auto_edit', 'yolo']);
  });

  it('passes the model, except auto, and prefixes the system prompt', () => {
    expect(geminiArgs({ ...spec, model: 'gemini-2.5-flash' })).toContain('gemini-2.5-flash');
    expect(geminiArgs({ ...spec, model: 'gemini-2.5-flash' }).slice(-2)).toEqual(['-m', 'gemini-2.5-flash']);
    expect(geminiArgs({ ...spec, model: 'auto' })).not.toContain('-m');
    expect(geminiArgs({ ...spec, systemPrompt: 'be brief' })[0]).toBe('--prompt=be brief\n\ndo it');
  });

  it('keeps a dash-leading prompt from becoming a flag', () => {
    expect(geminiArgs({ ...spec, prompt: '--yolo' })[0]).toBe('--prompt=--yolo');
  });

  it('maps pre-approved Claude rules to --allowed-tools and never puts secrets in argv', () => {
    const args = geminiArgs({
      ...spec,
      preApprovedTools: ['Read', 'Bash(git:*)', 'Bash(npm test)', 'WebFetch', 'Nope'],
    });
    expect(args.slice(5)).toEqual([
      '--allowed-tools',
      'read_file',
      '--allowed-tools',
      'run_shell_command(git)',
      '--allowed-tools',
      'run_shell_command(npm test)',
      '--allowed-tools',
      'web_fetch',
    ]);
    expect(args.join(' ')).not.toContain('tok');
  });

  it('maps tool names for native excludes and drops scoped or unknown rules', () => {
    expect(geminiToolNames(['Bash', 'Edit', 'Bash(rm:*)', 'Mystery'])).toEqual([
      'run_shell_command',
      'replace',
    ]);
    expect(geminiAllowedTools(undefined)).toEqual([]);
  });
});

describe('gemini env isolation', () => {
  it('sets GEMINI_CLI_HOME to the managed account dir with identity and run variables', () => {
    expect(runEnv(spec, 'gemini')).toMatchObject({
      GEMINI_CLI_HOME: '/data/accounts/gemini-savigo',
      GIT_AUTHOR_NAME: 'Agent',
      AGENT_BAND_AGENT_ID: 'agent-1',
      AGENT_BAND_RUN_ID: 'run-1',
      AGENT_BAND_RUN_TOKEN: 'tok',
    });
  });

  it('leaves the variable unset for the default home (~ or ~/.gemini)', () => {
    expect(runEnv({ ...spec, configDir: join(homedir(), '.gemini') }, 'gemini')).not.toHaveProperty(
      'GEMINI_CLI_HOME',
    );
    expect(runEnv({ ...spec, configDir: homedir() }, 'gemini')).not.toHaveProperty('GEMINI_CLI_HOME');
  });

  it('points the CLI at the per-run settings and drops inherited auth variables', () => {
    process.env.GEMINI_API_KEY = 'inherited';
    process.env.GOOGLE_API_KEY = 'inherited';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    try {
      const env = geminiEnv({ ...spec, geminiSettingsPath: '/runs/1/gemini/settings.json' });
      expect(env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBe('/runs/1/gemini/settings.json');
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.GOOGLE_API_KEY).toBeUndefined();
      expect(env.GOOGLE_GENAI_USE_VERTEXAI).toBeUndefined();
      expect(env.GEMINI_CLI_HOME).toBe('/data/accounts/gemini-savigo');
    } finally {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    }
  });

  it('passes an api account key through the spec env only', () => {
    const env = geminiEnv({ ...spec, env: { GEMINI_API_KEY: 'run-key' } });
    expect(env.GEMINI_API_KEY).toBe('run-key');
    expect(geminiArgs({ ...spec, env: { GEMINI_API_KEY: 'run-key' } }).join(' ')).not.toContain('run-key');
  });
});
