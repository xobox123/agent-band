/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApi, TEST_SECRET, type TestApi } from './test-helpers.ts';

let api: TestApi;
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  await api.close();
});

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const res = await api.app.inject({ method, url: `/api/v1${url}`, payload: payload as object });
  return {
    status: res.statusCode,
    body: res.body,
    json: () => (res.body ? (JSON.parse(res.body) as Record<string, any>) : {}),
    type: String(res.headers['content-type']),
  };
}

async function seedAgent(slug = 'alpha') {
  const account = await call('POST', '/accounts', {
    name: `acc-${slug}`,
    provider: 'claude',
    type: 'cli',
    configDir: `/tmp/${slug}`,
  });
  expect(account.status).toBe(201);
  const agent = await call('POST', '/agents', { slug, name: slug, accountId: account.json().id });
  expect(agent.status).toBe(201);
  return { account: account.json(), agent: agent.json() };
}

describe('org', () => {
  it('reads and updates the organization, lists users and principals', async () => {
    const org = await call('GET', '/organization');
    expect(org.status).toBe(200);
    const patched = await call('PATCH', '/organization', { name: 'Acme', taskKeyPrefix: 'AC' });
    expect(patched.json().name).toBe('Acme');

    const users = (await call('GET', '/users')).json();
    expect(users.items.map((u: { handle: string }) => u.handle)).toContain('user:local');
    expect(typeof users.cursor).toBe('number');

    const me = (await call('GET', '/me')).json();
    expect(me.handle).toBe('user:local');
    const principals = (await call('GET', '/principals?kind=system')).json();
    expect(principals.items.every((p: { kind: string }) => p.kind === 'system')).toBe(true);
    expect((await call('GET', `/principals/${me.id}`)).status).toBe(200);
  });

  it('manages teams, members and role bindings', async () => {
    const team = await call('POST', '/teams', { name: 'Platform' });
    expect(team.status).toBe(201);
    const me = (await call('GET', '/me')).json();
    const member = await call('POST', `/teams/${team.json().id}/members`, { userId: me.id });
    expect(member.status).toBe(204);
    expect((await call('GET', '/teams')).json().items[0].memberIds).toEqual([me.id]);

    const binding = await call('POST', '/role-bindings', {
      subject: { teamId: team.json().id },
      role: 'viewer',
      scope: { org: true },
    });
    expect(binding.status).toBe(201);
    expect((await call('GET', '/role-bindings')).json().items.length).toBe(2);
    expect((await call('DELETE', `/role-bindings/${binding.json().id}`)).status).toBe(204);
  });

  it('creates the baseline policy once and binds it to the org', async () => {
    const org = (await call('GET', '/organization')).json();
    expect(org.policyId).toBeTruthy();
    const policy = (await call('GET', `/policies/${org.policyId}`)).json();
    expect(policy.name).toBe('Default');
    expect(policy.rules).toEqual({ maxMode: 'edit' });
  });
});

describe('accounts', () => {
  it('lists providers and never returns the secret', async () => {
    const providers = (await call('GET', '/providers')).json();
    expect(providers.items.map((p: { id: string }) => p.id)).toContain('claude');

    const created = await call('POST', '/accounts', {
      name: 'api',
      provider: 'claude',
      type: 'api',
      secret: TEST_SECRET,
    });
    expect(created.status).toBe(201);
    expect(created.json().hasSecret).toBe(true);
    const id = created.json().id;
    const patched = await call('PATCH', `/accounts/${id}`, { labels: ['x'], secret: `${TEST_SECRET}-2` });
    expect(patched.json().labels).toEqual(['x']);
    expect(
      (await call('PUT', `/accounts/${id}/provider-identity`, { providerIdentity: 'a@b.c' })).status,
    ).toBe(200);
    expect((await call('GET', '/accounts?type=api')).json().items.length).toBe(1);
    expect((await call('DELETE', `/accounts/${id}`)).status).toBe(204);
    expect((await call('GET', `/accounts/${id}`)).status).toBe(404);
  });

  it('refuses to delete an account used by agents', async () => {
    const { account } = await seedAgent();
    const res = await call('DELETE', `/accounts/${account.id}`);
    expect(res.status).toBe(409);
    expect(res.json().code).toBe('account_in_use');
  });
});

describe('agents and groups', () => {
  it('runs the agent and group flow', async () => {
    const { agent } = await seedAgent();
    const group = await call('POST', '/agent-groups', { name: 'backend', labels: ['be'] });
    expect(group.status).toBe(201);
    const gid = group.json().id;
    const added = await call('PUT', `/agent-groups/${gid}/members/${agent.id}`);
    expect(added.json().agentIds).toEqual([agent.id]);
    expect((await call('GET', `/agents?groupId=${gid}`)).json().items.length).toBe(1);
    expect((await call('PATCH', `/agents/${agent.id}`, { persona: 'careful' })).json().persona).toBe(
      'careful',
    );
    expect((await call('DELETE', `/agent-groups/${gid}/members/${agent.id}`)).json().agentIds).toEqual([]);
    expect((await call('PATCH', `/agent-groups/${gid}`, { description: 'd' })).json().description).toBe('d');
    expect((await call('GET', '/agent-groups')).json().items.length).toBe(1);
    expect((await call('DELETE', `/agent-groups/${gid}`)).status).toBe(204);
    expect((await call('DELETE', `/agents/${agent.id}`)).status).toBe(204);
    expect((await call('GET', '/agents?enabled=true')).json().items.length).toBe(0);
  });
});

describe('policies and skills', () => {
  it('versions policies, binds them and resolves the effective policy', async () => {
    const { agent } = await seedAgent();
    const created = await call('POST', '/policies', { name: 'strict', rules: { maxMode: 'read-only' } });
    expect(created.status).toBe(201);
    const pid = created.json().id;
    const updated = await call('PATCH', `/policies/${pid}`, {
      rules: { maxMode: 'read-only', deniedTools: ['Bash'] },
    });
    expect(updated.json().currentVersion).toBe(2);
    expect(updated.json().versions.length).toBe(2);
    expect((await call('PATCH', `/policies/${pid}`, { name: 'stricter' })).json().name).toBe('stricter');
    expect((await call('GET', '/policies')).json().items.length).toBe(2);

    expect((await call('PATCH', `/agents/${agent.id}`, { policyId: pid })).json().policyId).toBe(pid);
    const effective = (await call('GET', `/agents/${agent.id}/effective-policy`)).json();
    expect(effective.maxMode).toBe('read-only');
    expect(effective.deniedTools).toEqual(['Bash']);
    expect(effective.sources.map((s: { level: string }) => s.level)).toEqual(['org', 'agent']);

    const missing = await call('PATCH', `/agents/${agent.id}`, { policyId: crypto.randomUUID() });
    expect(missing.status).toBe(400);
    expect((await call('PUT', '/organization/policy', { policyId: crypto.randomUUID() })).status).toBe(400);
    expect((await call('PUT', '/organization/policy', { policyId: pid })).json().policyId).toBe(pid);
  });

  it('imports skills, versions, assigns and resolves effective skills', async () => {
    const { agent } = await seedAgent();
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const skill = await call('POST', '/skills', {
      name: 'review',
      description: 'Code review',
      files: { 'SKILL.md': b64('# review') },
    });
    expect(skill.status).toBe(201);
    const sid = skill.json().id;
    const v2 = await call('POST', `/skills/${sid}/versions`, { files: { 'SKILL.md': b64('# review v2') } });
    expect(v2.json().currentVersion).toBe(2);
    expect((await call('GET', `/skills/${sid}`)).json().versions.length).toBe(2);
    expect((await call('GET', '/skills')).json().items.length).toBe(1);
    const bad = await call('POST', '/skills', { name: 'bad', files: { 'x.md': b64('x') } });
    expect(bad.status).toBe(400);

    const assignment = await call('POST', '/skill-assignments', {
      skillId: sid,
      scope: { agentId: agent.id },
      pinnedVersion: 1,
    });
    expect(assignment.status).toBe(201);
    expect((await call('GET', `/skill-assignments?skillId=${sid}`)).json().items.length).toBe(1);
    const eff = (await call('GET', `/agents/${agent.id}/effective-skills`)).json();
    expect(eff.items).toMatchObject([{ name: 'review', version: 1 }]);
    expect((await call('DELETE', `/skill-assignments/${assignment.json().id}`)).status).toBe(204);
    expect((await call('GET', `/agents/${agent.id}/effective-skills`)).json().items).toEqual([]);
  });
});

describe('tasks, runs and dashboard', () => {
  it('runs the task flow', async () => {
    const { agent } = await seedAgent();
    const body = { title: 'Fix', prompt: 'Do it', workDir: '/work', target: { agentId: agent.id } };
    const t1 = (await call('POST', '/tasks', body)).json();
    const t2 = (await call('POST', '/tasks', { ...body, title: 'Second' })).json();
    expect(t1.key).toMatch(/-1$/);
    expect((await call('GET', `/tasks/${t1.id}`)).json().title).toBe('Fix');
    expect((await call('GET', `/tasks?text=Second`)).json().items.length).toBe(1);
    expect((await call('GET', `/tasks?agentId=${agent.id}&status=queued`)).json().items.length).toBe(2);

    expect((await call('PATCH', `/tasks/${t2.id}`, { priority: 0 })).json().priority).toBe(0);
    const reorder = await call('POST', `/tasks/${t1.id}/reorder`, {});
    expect(reorder.status).toBe(200);
    const board = (await call('GET', '/board')).json();
    expect(board.columns.queued.length).toBe(2);
    expect(board.columns.queued[0].id).toBe(t2.id);
    expect(typeof board.cursor).toBe('number');

    const cancelled = await call('POST', `/tasks/${t1.id}/cancel`);
    expect(cancelled.json().status).toBe('cancelled');
    const outbox = await api.database.db.execute(
      (await import('drizzle-orm')).sql`select type from outbox_events where type = 'task.cancel_requested'`,
    );
    expect((outbox as { rows: unknown[] }).rows.length).toBe(1);
    expect((await call('POST', `/tasks/${t1.id}/cancel`)).status).toBe(409);
  });

  it('lists runs, events after an id, and builds the dashboard', async () => {
    const { agent, account } = await seedAgent();
    const task = (
      await call('POST', '/tasks', { title: 'T', prompt: 'p', workDir: '/w', target: { agentId: agent.id } })
    ).json();
    const sys = api.c.dispatcher;
    const db = api.database.db;
    const claimed = await db.transaction((tx) => api.c.tasks.claimNextTask(tx, sys, 'w1'));
    expect(claimed?.id).toBe(task.id);
    const run = await db.transaction(async (tx) => {
      await api.c.tasks.setTaskStatus(tx, sys, task.id, 'running');
      return api.c.runs.startRun(tx, sys, {
        taskId: task.id,
        agentId: agent.id,
        accountId: account.id,
        workerId: 'w1',
        effectivePolicy: {},
        skills: [],
      });
    });
    const e1 = await db.transaction((tx) =>
      api.c.runs.appendRunEvent(tx, sys, run.id, { kind: 'text', text: 'hi' }),
    );
    await db.transaction((tx) =>
      api.c.runs.appendRunEvent(tx, sys, run.id, {
        kind: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
      }),
    );

    expect((await call('GET', `/runs?status=running&agentId=${agent.id}`)).json().items.length).toBe(1);
    expect((await call('GET', `/runs/${run.id}`)).json().inputTokens).toBe(10);
    const events = (await call('GET', `/runs/${run.id}/events?afterId=${e1.id}`)).json();
    expect(events.items.map((e: { kind: string }) => e.kind)).toEqual(['usage']);
    expect((await call('GET', `/runs/${run.id}/events`)).json().items.length).toBe(2);

    const dash = (await call('GET', '/dashboard')).json();
    expect(dash.tokensToday).toBe(15);
    expect(dash.queuedCount).toBe(0);
    expect(dash.runningRuns.length).toBe(1);
    expect(dash.agents[0]).toMatchObject({ status: 'running', runningRunId: run.id });
    expect(dash.accounts[0]).toMatchObject({ runningRuns: 1, tokensToday: 15, blockedUntil: null });
  });
});

describe('audit', () => {
  it('lists with a cursor, verifies a range and exports JSONL', async () => {
    await seedAgent();
    const page1 = (await call('GET', '/audit?limit=2')).json();
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await call('GET', `/audit?limit=2&cursor=${page1.nextCursor}`)).json();
    expect(page2.items[0].seq).toBeLessThan(page1.items[1].seq);

    const verify = (await call('GET', '/audit/verify')).json();
    expect(verify.ok).toBe(true);
    const ranged = (await call('GET', '/audit/verify?fromSeq=2&toSeq=4')).json();
    expect(ranged).toMatchObject({ ok: true, fromSeq: 2, toSeq: 4, count: 3 });

    const exported = await call('GET', `/audit/export?toSeq=3`);
    expect(exported.status).toBe(200);
    expect(exported.type).toContain('application/x-ndjson');
    const lines = exported.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { seq: number });
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.max(...lines.map((l) => l.seq))).toBeLessThanOrEqual(3);
  });

  it('rejects export for a non-owner before sending headers', async () => {
    api.as(await api.makeUser('user:admin', 'admin'));
    const res = await call('GET', '/audit/export');
    expect(res.status).toBe(403);
    expect(res.type).toContain('application/problem+json');
    expect(res.json().code).toBe('forbidden');
  });
});

describe('cross-cutting', () => {
  it('returns problem+json 400 on validation errors', async () => {
    const res = await call('POST', '/tasks', { title: '' });
    expect(res.status).toBe(400);
    expect(res.type).toContain('application/problem+json');
    expect(res.json().code).toBe('validation_failed');
    expect((await call('GET', '/tasks/not-a-uuid')).status).toBe(400);
    expect((await call('PATCH', '/organization', { bogus: 1 })).status).toBe(400);
  });

  it('enforces RBAC for a viewer', async () => {
    const { agent } = await seedAgent();
    api.as(await api.makeUser('user:viewer', 'viewer'));
    expect((await call('GET', '/agents')).status).toBe(200);
    const denied = await call('POST', '/tasks', {
      title: 'x',
      prompt: 'y',
      workDir: '/w',
      target: { agentId: agent.id },
    });
    expect(denied.status).toBe(403);
    expect((await call('POST', '/accounts', { name: 'a', provider: 'claude', type: 'cli' })).status).toBe(
      403,
    );
    expect((await call('POST', '/policies', { name: 'p', rules: {} })).status).toBe(403);
  });

  it('never leaks secrets in any response', async () => {
    const acc = await call('POST', '/accounts', {
      name: 'api',
      provider: 'claude',
      type: 'api',
      secret: TEST_SECRET,
    });
    const id = acc.json().id;
    const bodies = [acc.body];
    for (const url of [
      '/accounts',
      `/accounts/${id}`,
      '/dashboard',
      '/audit?limit=200',
      '/providers',
      '/organization',
      '/agents',
    ]) {
      bodies.push((await call('GET', url)).body);
    }
    bodies.push((await call('GET', '/audit/export')).body);
    for (const b of bodies) expect(b).not.toContain(TEST_SECRET);
  });

  it('lists every route in the OpenAPI document', async () => {
    const res = await api.app.inject({ url: '/api/openapi.json' });
    const doc = res.json<{ paths: Record<string, Record<string, unknown>> }>();
    const actual = Object.entries(doc.paths)
      .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`))
      .sort();
    expect(actual).toEqual(EXPECTED_ROUTES);
  });
});

const EXPECTED_ROUTES = [
  'GET /api/v1/accounts',
  'POST /api/v1/accounts',
  'GET /api/v1/accounts/{id}',
  'PATCH /api/v1/accounts/{id}',
  'DELETE /api/v1/accounts/{id}',
  'PUT /api/v1/accounts/{id}/provider-identity',
  'GET /api/v1/agent-groups',
  'POST /api/v1/agent-groups',
  'PATCH /api/v1/agent-groups/{id}',
  'DELETE /api/v1/agent-groups/{id}',
  'PUT /api/v1/agent-groups/{id}/members/{agentId}',
  'DELETE /api/v1/agent-groups/{id}/members/{agentId}',
  'GET /api/v1/agents',
  'POST /api/v1/agents',
  'GET /api/v1/agents/{id}',
  'PATCH /api/v1/agents/{id}',
  'DELETE /api/v1/agents/{id}',
  'GET /api/v1/agents/{id}/effective-policy',
  'GET /api/v1/agents/{id}/effective-skills',
  'GET /api/v1/audit',
  'GET /api/v1/audit/export',
  'GET /api/v1/audit/verify',
  'GET /api/v1/board',
  'GET /api/v1/dashboard',
  'GET /api/v1/events',
  'GET /api/v1/me',
  'GET /api/v1/organization',
  'PATCH /api/v1/organization',
  'PUT /api/v1/organization/policy',
  'GET /api/v1/policies',
  'POST /api/v1/policies',
  'GET /api/v1/policies/{id}',
  'PATCH /api/v1/policies/{id}',
  'GET /api/v1/principals',
  'GET /api/v1/principals/{id}',
  'GET /api/v1/providers',
  'GET /api/v1/role-bindings',
  'POST /api/v1/role-bindings',
  'DELETE /api/v1/role-bindings/{id}',
  'GET /api/v1/runs',
  'GET /api/v1/runs/{id}',
  'GET /api/v1/runs/{id}/events',
  'GET /api/v1/skill-assignments',
  'POST /api/v1/skill-assignments',
  'DELETE /api/v1/skill-assignments/{id}',
  'GET /api/v1/skills',
  'POST /api/v1/skills',
  'GET /api/v1/skills/{id}',
  'POST /api/v1/skills/{id}/versions',
  'GET /api/v1/tasks',
  'POST /api/v1/tasks',
  'GET /api/v1/tasks/{id}',
  'PATCH /api/v1/tasks/{id}',
  'POST /api/v1/tasks/{id}/cancel',
  'POST /api/v1/tasks/{id}/reorder',
  'GET /api/v1/teams',
  'POST /api/v1/teams',
  'POST /api/v1/teams/{teamId}/members',
  'GET /api/v1/users',
].sort();
