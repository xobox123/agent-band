import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeBins } from './fake-cli.testkit.ts';
import {
  loginCommand,
  probeAccount,
  probeApiKey,
  readClaudeUsage,
  readCodexUsage,
  startLogin,
} from './probe.ts';
import { readLatestCodexRateLimits } from './rollout.ts';

let bins: ReturnType<typeof fakeBins>;
beforeAll(() => {
  bins = fakeBins();
});
afterEach(() => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_LOG;
});
const tmp = () => mkdtempSync(join(tmpdir(), 'probe-'));

describe('probeAccount claude', () => {
  it('reads identity and plan when logged in', async () => {
    const r = await probeAccount({ provider: 'claude', configDir: tmp() }, { bins });
    expect(r).toMatchObject({
      loggedIn: true,
      identity: {
        email: 'ann@example.com',
        orgId: 'org-1',
        orgName: "Ann's Org",
        plan: 'pro',
        authMethod: 'claude.ai',
      },
      loginCommand: null,
    });
    expect(r.error).toBeUndefined();
  });

  it('reports not logged in with the exact login command for a separate dir', async () => {
    process.env.FAKE_MODE = 'out';
    const dir = join(tmp(), 'my acct');
    const r = await probeAccount({ provider: 'claude', configDir: dir }, { bins });
    expect(r.loggedIn).toBe(false);
    expect(r.loginCommand).toBe(`CLAUDE_CONFIG_DIR='${dir}' claude auth login`);
  });

  it('reports a missing CLI, garbage output and a timeout', async () => {
    const missing = { claude: { cmd: '/nonexistent/claude-cli' } };
    expect((await probeAccount({ provider: 'claude', configDir: null }, { bins: missing })).error).toMatch(
      /not found/,
    );
    process.env.FAKE_MODE = 'garbage';
    expect((await probeAccount({ provider: 'claude', configDir: null }, { bins })).error).toMatch(
      /unexpected output/,
    );
    process.env.FAKE_MODE = 'hang';
    const slow = await probeAccount({ provider: 'claude', configDir: null }, { bins, timeoutMs: 300 });
    expect(slow).toMatchObject({ loggedIn: false });
    expect(slow.error).toMatch(/did not answer/);
  });

  it('leaves the default dir implicit in the login command', () => {
    expect(loginCommand('claude', null)).toBe('claude auth login');
    expect(loginCommand('openai', '/x/y')).toBe('CODEX_HOME=/x/y codex login');
  });
});

describe('probeAccount codex', () => {
  it('reads account through the native app-server', async () => {
    process.env.FAKE_MODE = 'in';
    const r = await probeAccount({ provider: 'openai', configDir: tmp() }, { bins });
    expect(r).toMatchObject({
      loggedIn: true,
      identity: { email: 'bob@example.com', plan: 'plus', authMethod: 'chatgpt' },
    });
  });

  it('is not logged in without auth and gives the login command', async () => {
    const dir = tmp();
    const r = await probeAccount({ provider: 'openai', configDir: dir }, { bins });
    expect(r.loggedIn).toBe(false);
    expect(r.loginCommand).toBe(`CODEX_HOME=${dir} codex login`);
  });

  it('falls back to `codex login status` when app-server is unavailable', async () => {
    process.env.FAKE_MODE = 'no-app-server';
    const dir = tmp();
    writeFileSync(join(dir, 'auth.json'), '{}');
    const r = await probeAccount({ provider: 'openai', configDir: dir }, { bins });
    expect(r.loggedIn).toBe(true);
  });
});

describe('limits', () => {
  it('reads Claude windows from /usage', async () => {
    const r = await readClaudeUsage({ configDir: null }, { bins });
    expect(r.windows.map((w) => [w.window, w.usedPercent])).toEqual([
      ['5h', 32],
      ['weekly', 30],
    ]);
    expect(r.perModel[0]?.label).toBe('Sonnet');
  });

  it('fails clearly when /usage has no windows', async () => {
    process.env.FAKE_MODE = 'usage-fail';
    await expect(readClaudeUsage({ configDir: null }, { bins })).rejects.toThrow(/no limit windows/);
  });

  it('reads Codex windows, credits and daily tokens from app-server', async () => {
    process.env.FAKE_MODE = 'in';
    const r = await readCodexUsage({ configDir: tmp() }, { bins });
    expect(r.windows).toEqual([
      { window: '5h', usedPercent: 100, resetsAt: new Date(1791368863 * 1000).toISOString() },
      { window: 'weekly', usedPercent: 16, resetsAt: new Date(1791955663 * 1000).toISOString() },
    ]);
    expect(r.codex).toMatchObject({
      ordinaryUsageAllowed: false,
      limitReached: true,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      daily: [
        { date: '2026-07-09', tokens: 292114 },
        { date: '2026-07-10', tokens: 5 },
      ],
    });
  });
});

describe('latest codex rollout', () => {
  it('returns the windows of the newest rollout that has them', async () => {
    const home = tmp();
    const day = join(home, 'sessions', '2026', '10', '07');
    mkdirSync(day, { recursive: true });
    const line = (p: number) =>
      JSON.stringify({
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: p, resets_at: 1791368863 },
            secondary: { used_percent: 5, resets_at: 1791955663 },
          },
        },
      });
    writeFileSync(join(day, 'rollout-2026-10-07T08-00-00-aaa.jsonl'), line(10) + '\n');
    writeFileSync(join(day, 'rollout-2026-10-07T09-00-00-bbb.jsonl'), line(40) + '\n');
    const event = await readLatestCodexRateLimits(home);
    expect(event).toMatchObject({
      kind: 'rate_limit',
      windows: [{ window: '5h', usedPercent: 40 }, { window: 'weekly' }],
    });
    expect(await readLatestCodexRateLimits(join(home, 'none'))).toBeNull();
  });
});

describe('login', () => {
  it('spawns the official login with the account env and captures the URL', async () => {
    const dir = tmp();
    process.env.FAKE_LOG = join(dir, 'log.jsonl');
    const h = await startLogin({ provider: 'claude', configDir: dir, mode: 'console' }, { bins });
    expect(h).toMatchObject({ started: true, authUrl: 'https://claude.ai/oauth/authorize?x=1' });
    await h.done;
    const logged = JSON.parse(readFileSync(process.env.FAKE_LOG, 'utf8')) as { args: string[]; dir: string };
    expect(logged).toEqual({ args: ['auth', 'login', '--console'], dir });
    expect((await probeAccount({ provider: 'claude', configDir: dir }, { bins })).loggedIn).toBe(true);
  });

  it('reports when the CLI cannot be started', async () => {
    const h = await startLogin(
      { provider: 'claude', configDir: tmp() },
      { bins: { claude: { cmd: '/nonexistent/claude-cli' } } },
    );
    expect(h.started).toBe(false);
    expect(h.command).toMatch(/claude auth login$/);
  });

  it('uses the native Codex login and hands the URL to the opener', async () => {
    const dir = tmp();
    let opened = '';
    const h = await startLogin(
      { provider: 'openai', configDir: dir },
      {
        bins,
        openUrl: (u) => {
          opened = u;
        },
      },
    );
    expect(h.authUrl).toBe('https://auth.openai.com/oauth/authorize?native=1');
    expect(opened).toBe(h.authUrl);
    await h.done;
    expect(readFileSync(join(dir, 'auth.json'), 'utf8')).toContain('chatgpt');
  });
});

describe('api keys', () => {
  it('checks a Claude key through the environment only', async () => {
    const r = await probeApiKey({ provider: 'claude', configDir: tmp(), apiKey: 'sk-ant-secret' }, { bins });
    expect(r).toMatchObject({ loggedIn: true, identity: { plan: 'API key', authMethod: 'api_key' } });
    expect(r.note).toMatch(/first run/);
    expect(JSON.stringify(r)).not.toContain('sk-ant-secret');
  });

  it('stores a Codex key through its own login with the key on stdin', async () => {
    const dir = tmp();
    const r = await probeApiKey({ provider: 'openai', configDir: dir, apiKey: 'sk-openai-secret' }, { bins });
    expect(r).toMatchObject({ loggedIn: true, identity: { plan: 'API key', authMethod: 'apiKey' } });
    expect(JSON.stringify(r)).not.toContain('sk-openai-secret');
  });
});
