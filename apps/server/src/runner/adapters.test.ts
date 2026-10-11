import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSpec } from '@agent-band/contracts';
import {
  ClaudeAdapter,
  CodexAdapter,
  GeminiAdapter,
  claudeArgs,
  codexArgs,
  geminiArgs,
  runEnv,
} from './adapters.ts';
import { spawnJsonLines } from './process.ts';
import { readCodexRateLimits } from './rollout.ts';
vi.mock('./process.ts', () => ({ spawnJsonLines: vi.fn() }));
vi.mock('./rollout.ts', () => ({ readCodexRateLimits: vi.fn() }));
const spec: RunSpec = {
  runId: 'run',
  agentId: 'agent',
  prompt: 'hello',
  workDir: '/work',
  configDir: '/config',
  mode: 'edit',
  gitIdentity: { name: 'Agent', email: 'agent@example.com' },
};
beforeEach(() => vi.clearAllMocks());
describe('provider wiring', () => {
  it('wires Claude arguments, working directory and inherited environment', () => {
    new ClaudeAdapter().start(spec);
    expect(spawnJsonLines).toHaveBeenCalledWith(
      {
        cmd: 'claude',
        args: claudeArgs(spec),
        cwd: '/work',
        env: { ...process.env, ...runEnv(spec, 'claude') },
        missingMessage: 'Claude Code CLI not found. Install it or set AGENT_BAND_CLAUDE_BIN',
      },
      expect.any(Function),
    );
  });
  it('wires Gemini arguments, isolated environment and the stream parser', () => {
    new GeminiAdapter().start({ ...spec, geminiSettingsPath: '/runs/1/gemini/settings.json' });
    const call = vi.mocked(spawnJsonLines).mock.calls[0];
    if (!call) throw new Error('Missing spawn call');
    const { env, ...rest } = call[0];
    expect(rest).toEqual({
      cmd: 'gemini',
      args: geminiArgs(spec),
      cwd: '/work',
      missingMessage: 'Gemini CLI not found. Install it or set AGENT_BAND_GEMINI_BIN',
    });
    expect(env).toMatchObject({
      GEMINI_CLI_HOME: '/config',
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: '/runs/1/gemini/settings.json',
    });
    expect(call[1]('{"type":"init","session_id":"s1","model":"m"}')).toEqual([
      { kind: 'session', sessionId: 's1' },
    ]);
  });
  it('captures the Codex session and appends its rollout limits', async () => {
    new CodexAdapter().start(spec);
    const call = vi.mocked(spawnJsonLines).mock.calls[0];
    if (!call) throw new Error('Missing spawn call');
    expect(call[0]).toEqual({
      cmd: 'codex',
      args: codexArgs(spec),
      cwd: '/work',
      env: { ...process.env, ...runEnv(spec, 'openai') },
      missingMessage: 'Codex CLI not found. Install it or set AGENT_BAND_CODEX_BIN',
    });
    expect(await call[2]?.()).toEqual([]);
    expect(readCodexRateLimits).not.toHaveBeenCalled();
    expect(call[1]('{"type":"thread.started","thread_id":"thread"}')).toEqual([
      { kind: 'session', sessionId: 'thread' },
    ]);
    const event = { kind: 'rate_limit' as const, windows: [], limitReached: false, resetsAt: null };
    vi.mocked(readCodexRateLimits).mockResolvedValue(event);
    expect(await call[2]?.()).toEqual([event]);
    expect(readCodexRateLimits).toHaveBeenCalledWith('/config', 'thread');
    vi.mocked(readCodexRateLimits).mockResolvedValue(null);
    expect(await call[2]?.()).toEqual([]);
  });
});
