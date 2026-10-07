/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountDto, ProbeResult, RefreshLimitsResult } from '@agent-band/contracts';
import { fakeBins } from '../../runner/fake-cli.testkit.ts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
let home: string;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  api = await makeApi({ cliBins: fakeBins(), home });
});
afterEach(async () => {
  delete process.env.FAKE_MODE;
  await api.close();
});
async function call(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const res = await api.app.inject({ method, url: `/api/v1${url}`, payload: payload as object });
  return { status: res.statusCode, body: res.body, json: () => JSON.parse(res.body) as Record<string, any> };
}
const identityAudits = async () =>
  (await call('GET', '/audit?limit=200'))
    .json()
    .items.filter((e: { action: string }) => e.action === 'account.identity_set');

describe('probe-config', () => {
  it('shows email and plan for a logged in directory and the command otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const ok = await call('POST', '/accounts/probe-config', {
      provider: 'claude',
      type: 'cli',
      configDir: dir,
    });
    expect(ProbeResult.parse(ok.json())).toMatchObject({ loggedIn: true, identity: { plan: 'pro' } });
    process.env.FAKE_MODE = 'out';
    const out = ProbeResult.parse(
      (
        await call('POST', '/accounts/probe-config', { provider: 'claude', type: 'cli', configDir: dir })
      ).json(),
    );
    expect(out.loggedIn).toBe(false);
    expect(out.loginCommand).toBe(`CLAUDE_CONFIG_DIR=${dir} claude auth login`);
  });

  it('expands ~ and rejects relative directories', async () => {
    const bad = await call('POST', '/accounts/probe-config', {
      provider: 'claude',
      type: 'cli',
      configDir: 'rel',
    });
    expect(bad.status).toBe(400);
    const tilde = await call('POST', '/accounts/probe-config', {
      provider: 'claude',
      type: 'cli',
      configDir: '~/.claude-nothing-here',
    });
    expect(tilde.status).toBe(200);
  });

  it('needs the key to test an api account and never echoes it', async () => {
    expect((await call('POST', '/accounts/probe-config', { provider: 'claude', type: 'api' })).status).toBe(
      400,
    );
    const res = await call('POST', '/accounts/probe-config', {
      provider: 'openai',
      type: 'api',
      secret: 'sk-secret-xyz',
    });
    expect(res.json()).toMatchObject({ loggedIn: true });
    expect(res.body).not.toContain('sk-secret-xyz');
  });

  it('is refused for non-cli providers and for viewers', async () => {
    expect((await call('POST', '/accounts/probe-config', { provider: 'gemini', type: 'cli' })).status).toBe(
      400,
    );
    api.as(await api.makeUser('viewer', 'viewer'));
    expect((await call('POST', '/accounts/probe-config', { provider: 'claude', type: 'cli' })).status).toBe(
      403,
    );
  });
});

describe('account probe', () => {
  it('stores connection and identity, and audits only when the identity changes', async () => {
    const created = await call('POST', '/accounts', { name: 'Work', provider: 'claude', type: 'cli' });
    expect(created.status).toBe(201);
    expect(AccountDto.parse(created.json()).connection).toBeNull();
    const id = created.json().id as string;

    const first = await call('POST', `/accounts/${id}/probe`);
    expect(first.status).toBe(200);
    const acc = AccountDto.parse((await call('GET', `/accounts/${id}`)).json());
    expect(acc.providerIdentity).toBe("ann@example.com (Ann's Org)");
    expect(acc.connection).toMatchObject({
      loggedIn: true,
      plan: 'pro',
      email: 'ann@example.com',
      orgName: "Ann's Org",
      authMethod: 'claude.ai',
    });
    expect(await identityAudits()).toHaveLength(1);
    await call('POST', `/accounts/${id}/probe`);
    expect(await identityAudits()).toHaveLength(1);
  });

  it('records a failed check without touching the identity', async () => {
    const id = (await call('POST', '/accounts', { name: 'W', provider: 'claude', type: 'cli' })).json().id;
    process.env.FAKE_MODE = 'out';
    const res = await call('POST', `/accounts/${id}/probe`);
    expect(res.json()).toMatchObject({ loggedIn: false });
    const acc = AccountDto.parse((await call('GET', `/accounts/${id}`)).json());
    expect(acc.connection?.loggedIn).toBe(false);
    expect(acc.providerIdentity).toBeNull();
  });

  it('is refused for viewers and unknown accounts', async () => {
    const id = (await call('POST', '/accounts', { name: 'W', provider: 'claude', type: 'cli' })).json().id;
    expect((await call('POST', `/accounts/${randomId()}/probe`)).status).toBe(404);
    api.as(await api.makeUser('viewer', 'viewer'));
    expect((await call('POST', `/accounts/${id}/probe`)).status).toBe(403);
  });

  it('probes every cli account in the background pass', async () => {
    await call('POST', '/accounts', { name: 'A', provider: 'claude', type: 'cli' });
    await call('POST', '/accounts', { name: 'B', provider: 'openai', type: 'cli' });
    process.env.FAKE_MODE = 'in';
    await api.c.accountConnection.probeAll();
    const list = (await call('GET', '/accounts')).json().items as { connection: { loggedIn: boolean } }[];
    expect(list.map((a) => a.connection.loggedIn)).toEqual([true, true]);
  });
});

describe('managed directories and login', () => {
  it('creates a private managed directory for another account', async () => {
    const a = AccountDto.parse(
      (
        await call('POST', '/accounts', {
          name: 'Side Gig',
          provider: 'claude',
          type: 'cli',
          managedConfigDir: true,
        })
      ).json(),
    );
    expect(a.configDir).toBe(join(home, 'accounts', 'claude-side-gig'));
    expect(statSync(a.configDir ?? '').mode & 0o777).toBe(0o700);
    const b = AccountDto.parse(
      (
        await call('POST', '/accounts', {
          name: 'Side Gig',
          provider: 'claude',
          type: 'cli',
          managedConfigDir: true,
        })
      ).json(),
    );
    expect(b.configDir).not.toBe(a.configDir);
    expect(existsSync(b.configDir ?? '')).toBe(true);
  });

  it('rejects a managed directory together with an explicit one', async () => {
    const res = await call('POST', '/accounts', {
      name: 'x',
      provider: 'claude',
      type: 'cli',
      managedConfigDir: true,
      configDir: '/tmp/x',
    });
    expect(res.status).toBe(400);
  });

  it('logs in through the official command and probes when it ends', async () => {
    process.env.FAKE_MODE = 'out';
    const created = await call('POST', '/accounts', {
      name: 'Other',
      provider: 'claude',
      type: 'cli',
      managedConfigDir: true,
    });
    const id = created.json().id as string;
    await call('POST', `/accounts/${id}/probe`);
    expect((await call('GET', `/accounts/${id}`)).json().connection.loggedIn).toBe(false);
    const login = await call('POST', `/accounts/${id}/login`, { mode: 'console' });
    expect(login.json()).toMatchObject({ started: true, authUrl: 'https://claude.ai/oauth/authorize?x=1' });
    expect(login.json().command).toMatch(/^CLAUDE_CONFIG_DIR=.* claude auth login$/);
    await api.c.accountConnection.loginSettled(id);
    expect((await call('GET', `/accounts/${id}`)).json().connection).toMatchObject({
      loggedIn: true,
      email: 'ann@example.com',
    });
  });

  it('uses the native Codex login and returns its URL', async () => {
    const id = (
      await call('POST', '/accounts', { name: 'Cx', provider: 'openai', type: 'cli', managedConfigDir: true })
    ).json().id as string;
    const login = await call('POST', `/accounts/${id}/login`);
    expect(login.json()).toMatchObject({
      started: true,
      authUrl: 'https://auth.openai.com/oauth/authorize?native=1',
    });
    await api.c.accountConnection.loginSettled(id);
    expect((await call('GET', `/accounts/${id}`)).json().connection).toMatchObject({
      loggedIn: true,
      email: 'bob@example.com',
      plan: 'plus',
    });
  });

  it('returns the command to copy when the CLI cannot be started', async () => {
    const down = await makeApi({
      home,
      cliBins: { claude: { cmd: '/nonexistent/claude' }, openai: { cmd: '/nonexistent/codex' } },
    });
    try {
      const created = await down.app.inject({
        method: 'POST',
        url: '/api/v1/accounts',
        payload: { name: 'N', provider: 'claude', type: 'cli', managedConfigDir: true },
      });
      const res = await down.app.inject({
        method: 'POST',
        url: `/api/v1/accounts/${created.json().id}/login`,
      });
      expect(res.json()).toMatchObject({ started: false });
      expect(res.json().command).toMatch(/claude auth login$/);
    } finally {
      await down.close();
    }
  });
});

describe('refresh limits', () => {
  it('records Claude windows from /usage and exposes freshness on the dashboard', async () => {
    const id = (await call('POST', '/accounts', { name: 'W', provider: 'claude', type: 'cli' })).json()
      .id as string;
    await call('POST', `/accounts/${id}/probe`);
    const res = RefreshLimitsResult.parse((await call('POST', `/accounts/${id}/refresh-limits`)).json());
    expect(res.error).toBeNull();
    expect(res.windows.map((w) => w.usedPercent)).toEqual([32, 30]);
    expect(res.details?.perModel[0]?.label).toBe('Sonnet');
    const dash = (await call('GET', '/dashboard')).json();
    expect(dash.accounts[0].windows).toHaveLength(2);
    expect(dash.accounts[0].windowsUpdatedAt).not.toBeNull();
    expect(dash.accounts[0].account.connection.usageDetails.perModel).toHaveLength(1);
  });

  it('returns the last known windows with an error when the CLI fails', async () => {
    const id = (await call('POST', '/accounts', { name: 'W', provider: 'claude', type: 'cli' })).json()
      .id as string;
    await call('POST', `/accounts/${id}/probe`);
    await call('POST', `/accounts/${id}/refresh-limits`);
    process.env.FAKE_MODE = 'usage-fail';
    const res = RefreshLimitsResult.parse((await call('POST', `/accounts/${id}/refresh-limits`)).json());
    expect(res.error).toMatch(/no limit windows/);
    expect(res.windows).toHaveLength(2);
  });

  it('reads Codex limits, credits and daily tokens natively', async () => {
    process.env.FAKE_MODE = 'in';
    const id = (await call('POST', '/accounts', { name: 'Cx', provider: 'openai', type: 'cli' })).json()
      .id as string;
    await call('POST', `/accounts/${id}/probe`);
    const res = RefreshLimitsResult.parse((await call('POST', `/accounts/${id}/refresh-limits`)).json());
    expect(res.windows.map((w) => w.window)).toEqual(['5h', 'weekly']);
    expect(res.details).toMatchObject({ ordinaryUsageAllowed: false, limitReached: true });
    expect(res.details?.daily).toHaveLength(2);
  });
});

describe('api key accounts', () => {
  it('gets a private home, a verified connection and never exposes the key', async () => {
    const key = 'sk-ant-never-leak-me';
    const res = await call('POST', '/accounts', {
      name: 'Billing',
      provider: 'claude',
      type: 'api',
      secret: key,
    });
    expect(res.status).toBe(201);
    const acc = AccountDto.parse(res.json());
    expect(acc.configDir).toBe(join(home, 'accounts', 'claude-billing'));
    expect(acc.connection).toMatchObject({ loggedIn: true, plan: 'API key', authMethod: 'api_key' });
    const bodies = [
      res.body,
      (await call('GET', '/accounts')).body,
      (await call('GET', '/audit?limit=200')).body,
    ];
    for (const b of bodies) expect(b).not.toContain(key);
  });

  it('prepares the Codex home with the key through codex login', async () => {
    const res = await call('POST', '/accounts', {
      name: 'Oa',
      provider: 'openai',
      type: 'api',
      secret: 'sk-oa-secret',
    });
    expect(AccountDto.parse(res.json()).connection).toMatchObject({ loggedIn: true, plan: 'API key' });
    expect(existsSync(join(home, 'accounts', 'openai-oa', 'auth.json'))).toBe(true);
    expect(res.body).not.toContain('sk-oa-secret');
  });

  it('has no limit windows to refresh', async () => {
    const id = (
      await call('POST', '/accounts', { name: 'B', provider: 'claude', type: 'api', secret: 'k' })
    ).json().id;
    const res = RefreshLimitsResult.parse((await call('POST', `/accounts/${id}/refresh-limits`)).json());
    expect(res.windows).toEqual([]);
  });

  it('reports spend today and this month and enforces the cost budget in the dashboard', async () => {
    const id = (
      await call('POST', '/accounts', {
        name: 'B',
        provider: 'claude',
        type: 'api',
        secret: 'k',
        limits: { maxConcurrentRuns: 3, dailyCostBudgetUsd: 0.05 },
      })
    ).json().id as string;
    const system = { ...api.c.localUser, kind: 'system' as const };
    const task = await api.c.tasks.createTask(api.database.db, api.c.localUser, {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      target: { label: 'x' },
    });
    const run = await api.database.db.transaction((tx) =>
      api.c.runs.startRun(tx, system, {
        taskId: task.id,
        accountId: id,
        agentId: crypto.randomUUID(),
        workerId: 'w',
        effectivePolicy: {},
        skills: [],
      }),
    );
    await api.database.db.transaction((tx) =>
      api.c.runs.appendRunEvent(tx, system, run.id, {
        kind: 'usage',
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        costUsd: 0.07,
      }),
    );
    const row = (await call('GET', '/dashboard')).json().accounts[0];
    expect(row.costToday).toBeCloseTo(0.07);
    expect(row.costThisMonth).toBeCloseTo(0.07);
    expect(row.availabilityReason).toBe('cost_exhausted');
  });

  it('advertises runnable types in the provider registry', async () => {
    const items = (await call('GET', '/providers')).json().items as { id: string; runnableTypes: string[] }[];
    expect(items.find((p) => p.id === 'claude')?.runnableTypes).toEqual(['cli', 'api']);
    expect(items.find((p) => p.id === 'gemini')?.runnableTypes).toEqual([]);
  });
});

function randomId() {
  return crypto.randomUUID();
}
