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
    expect(policy.rules).toMatchObject({ maxMode: 'edit' });
    expect(policy.rules.workDirs).toEqual([org.workspaceRoot]);
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

describe('goals', () => {
  it('creates a goal for a leader and serves its tree and the goal list', async () => {
    const account = (
      await call('POST', '/accounts', { name: 'acc', provider: 'claude', type: 'cli', configDir: '/tmp/x' })
    ).json();
    const leader = (
      await call('POST', '/agents', { slug: 'boss', name: 'boss', accountId: account.id, role: 'leader' })
    ).json();
    const worker = (await call('POST', '/agents', { slug: 'wk', name: 'wk', accountId: account.id })).json();
    const body = { title: 'Goal', prompt: 'Ship', workDir: '/work', target: { agentId: leader.id } };

    const bad = await call('POST', '/tasks', { ...body, target: { agentId: worker.id }, kind: 'goal' });
    expect(bad.status).toBe(400);
    const limitsOnTask = await call('POST', '/tasks', { ...body, goalLimits: { maxRounds: 2 } });
    expect(limitsOnTask.status).toBe(400);

    const created = await call('POST', '/tasks', {
      ...body,
      kind: 'goal',
      goalLimits: { maxRounds: 2, maxSubtasks: 3, treeTokenBudget: 5000 },
    });
    expect(created.status).toBe(201);
    const goal = created.json();
    expect(goal).toMatchObject({ kind: 'goal', rootTaskId: goal.id, depth: 0, dependsOn: [], result: null });

    const tree = (await call('GET', `/tasks/${goal.id}/tree`)).json();
    expect(tree.goal).toMatchObject({
      rootTaskId: goal.id,
      status: 'planning',
      round: 1,
      treeTokensUsed: 0,
      limits: { maxRounds: 2, maxSubtasks: 3, treeTokenBudget: 5000 },
    });
    expect(tree.tasks.map((t: { id: string; tokens: number }) => [t.id, t.tokens])).toEqual([[goal.id, 0]]);
    expect(JSON.stringify(tree)).not.toContain('leaderSessionId');

    const goals = (await call('GET', '/goals')).json();
    expect(goals.items).toHaveLength(1);
    expect(goals.items[0].task.id).toBe(goal.id);
    expect((await call('GET', `/tasks/${crypto.randomUUID()}/tree`)).status).toBe(404);

    const plain = (await call('POST', '/tasks', { ...body, target: { agentId: worker.id } })).json();
    expect((await call('GET', `/tasks/${plain.id}/tree`)).status).toBe(404);
    expect(plain).toMatchObject({ kind: 'task', rootTaskId: null, eligibilityReason: null });
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
    // Queued tasks have no worker to notify.
    expect((outbox as { rows: unknown[] }).rows.length).toBe(0);
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
        cachedTokens: 7,
      }),
    );

    expect((await call('GET', `/runs?status=running&agentId=${agent.id}`)).json().items.length).toBe(1);
    expect((await call('GET', `/runs/${run.id}`)).json().inputTokens).toBe(10);
    const events = (await call('GET', `/runs/${run.id}/events?afterId=${e1.id}`)).json();
    expect(events.items.map((e: { kind: string }) => e.kind)).toEqual(['usage']);
    expect((await call('GET', `/runs/${run.id}/events`)).json().items.length).toBe(2);

    const dash = (await call('GET', '/dashboard')).json();
    expect(dash.tokensToday).toBe(15);
    expect(dash.cachedTokensToday).toBe(7);
    expect(dash.queuedCount).toBe(0);
    expect(dash.runningRuns.length).toBe(1);
    expect(dash.agents[0]).toMatchObject({ status: 'running', runningRunId: run.id });
    expect(dash.accounts[0]).toMatchObject({
      runningRuns: 1,
      tokensToday: 15,
      cachedTokensToday: 7,
      blockedUntil: null,
    });
  });
});

describe('schedules and scheduled tasks', () => {
  const template = (target: unknown) => ({ title: 'Nightly', prompt: 'Go', workDir: '/work', target });

  it('creates a scheduled task with runAt and shows it on the board', async () => {
    const { agent } = await seedAgent();
    const body = { title: 'Later', prompt: 'p', workDir: '/work', target: { agentId: agent.id } };
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const created = await call('POST', '/tasks', { ...body, runAt, maxAttempts: 4 });
    expect(created.status).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'scheduled',
      runAt,
      attempt: 1,
      maxAttempts: 4,
      resumeAt: null,
      scheduleId: null,
    });
    const board = (await call('GET', '/board')).json();
    expect(board.columns.scheduled.map((t: { id: string }) => t.id)).toEqual([created.json().id]);
    expect(board.columns.queued).toEqual([]);
    const past = await call('POST', '/tasks', {
      ...body,
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(400);
    expect((await call('POST', '/tasks', { ...body, runAt: 'tomorrow' })).status).toBe(400);
    const cancelled = await call('POST', `/tasks/${created.json().id}/cancel`);
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', runAt: null });
  });

  it('runs the schedule CRUD flow', async () => {
    const { agent } = await seedAgent();
    const body = {
      name: 'Nightly',
      cron: '0 2 * * *',
      timezone: 'Europe/Warsaw',
      template: template({ agentId: agent.id }),
    };
    const created = await call('POST', '/schedules', body);
    expect(created.status).toBe(201);
    const s = created.json();
    expect(s).toMatchObject({
      name: 'Nightly',
      enabled: true,
      overlap: 'skip',
      timezone: 'Europe/Warsaw',
      lastFiredAt: null,
      lastTaskId: null,
    });
    expect(s.template.priority).toBe(2);
    expect(Date.parse(s.nextFireAt)).toBeGreaterThan(Date.now());

    const list = (await call('GET', '/schedules')).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([s.id]);
    expect(typeof list.cursor).toBe('number');
    expect((await call('GET', `/schedules/${s.id}`)).json().id).toBe(s.id);

    const patched = await call('PATCH', `/schedules/${s.id}`, {
      enabled: false,
      overlap: 'queue',
      timezone: null,
    });
    expect(patched.json()).toMatchObject({ enabled: false, overlap: 'queue', timezone: null });
    expect((await call('PATCH', `/schedules/${s.id}`, { cron: 'nope' })).status).toBe(400);
    expect((await call('PATCH', `/schedules/${s.id}`, { bogus: 1 })).status).toBe(400);

    expect((await call('DELETE', `/schedules/${s.id}`)).status).toBe(204);
    expect((await call('GET', `/schedules/${s.id}`)).status).toBe(404);
    expect((await call('DELETE', `/schedules/${s.id}`)).status).toBe(404);
  });

  it('validates create bodies', async () => {
    const { agent } = await seedAgent();
    const ok = { name: 'n', cron: '* * * * *', template: template({ agentId: agent.id }) };
    expect((await call('POST', '/schedules', { ...ok, cron: '* * * *' })).status).toBe(400);
    expect((await call('POST', '/schedules', { ...ok, timezone: 'Mars/Base' })).status).toBe(400);
    expect((await call('POST', '/schedules', { ...ok, overlap: 'both' })).status).toBe(400);
    expect((await call('POST', '/schedules', { ...ok, template: { title: 'x' } })).status).toBe(400);
    expect((await call('GET', '/schedules')).json().items).toEqual([]);
  });

  it('previews the next five fire times and rejects bad input', async () => {
    const res = await call('GET', '/schedules/preview?cron=0%209%20*%20*%20*&timezone=Europe/Warsaw');
    expect(res.status).toBe(200);
    const times: string[] = res.json().fireTimes;
    expect(times).toHaveLength(5);
    expect(times.every((t) => new Date(t).getUTCMinutes() === 0)).toBe(true);
    expect((await call('GET', '/schedules/preview?cron=bad')).status).toBe(400);
    expect((await call('GET', '/schedules/preview')).status).toBe(400);
  });

  it('run-now creates a task, lists it under the schedule and keeps nextFireAt', async () => {
    const { agent } = await seedAgent();
    const s = (
      await call('POST', '/schedules', {
        name: 'n',
        cron: '0 2 * * *',
        template: template({ agentId: agent.id }),
      })
    ).json();
    const run = await call('POST', `/schedules/${s.id}/run-now`);
    expect(run.status).toBe(201);
    expect(run.json()).toMatchObject({ scheduleId: s.id, status: 'queued', title: 'Nightly' });
    const tasks = (await call('GET', `/schedules/${s.id}/tasks`)).json();
    expect(tasks.items.map((t: { id: string }) => t.id)).toEqual([run.json().id]);
    const after = (await call('GET', `/schedules/${s.id}`)).json();
    expect(after.nextFireAt).toBe(s.nextFireAt);
    expect(after.lastTaskId).toBe(run.json().id);
    expect((await call('POST', `/schedules/${crypto.randomUUID()}/run-now`)).status).toBe(404);
    expect((await call('GET', `/schedules/${crypto.randomUUID()}/tasks`)).status).toBe(404);
  });

  it('a scheduler tick fires the schedule and releases scheduled tasks', async () => {
    const { agent } = await seedAgent();
    const s = (
      await call('POST', '/schedules', {
        name: 'n',
        cron: '0 2 * * *',
        template: template({ agentId: agent.id }),
      })
    ).json();
    const later = new Date(Date.now() + 3 * 86_400_000);
    const result = await api.c.scheduler.tick(api.database.db, api.c.schedulerActor, later);
    expect(result).toMatchObject({ leader: true, fired: 1 });
    const tasks = (await call('GET', `/schedules/${s.id}/tasks`)).json().items;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduleId).toBe(s.id);
    expect((await call('GET', `/schedules/${s.id}`)).json().lastTaskId).toBe(tasks[0].id);
  });

  it('lets viewers read but not change schedules', async () => {
    const { agent } = await seedAgent();
    const s = (
      await call('POST', '/schedules', {
        name: 'n',
        cron: '0 2 * * *',
        template: template({ agentId: agent.id }),
      })
    ).json();
    api.as(await api.makeUser('viewer', 'viewer'));
    expect((await call('GET', '/schedules')).status).toBe(200);
    expect((await call('GET', `/schedules/${s.id}`)).status).toBe(200);
    expect((await call('GET', '/schedules/preview?cron=*%20*%20*%20*%20*')).status).toBe(200);
    expect(
      (await call('POST', '/schedules', { name: 'x', cron: '* * * * *', template: s.template })).status,
    ).toBe(403);
    expect((await call('PATCH', `/schedules/${s.id}`, { enabled: false })).status).toBe(403);
    expect((await call('DELETE', `/schedules/${s.id}`)).status).toBe(403);
    expect((await call('POST', `/schedules/${s.id}/run-now`)).status).toBe(403);
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
  'PUT /api/v1/accounts/{id}/pause',
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
  'PUT /api/v1/agents/{id}/pause',
  'GET /api/v1/agents/{id}/effective-policy',
  'GET /api/v1/agents/{id}/effective-skills',
  'GET /api/v1/audit',
  'GET /api/v1/audit/export',
  'GET /api/v1/audit/verify',
  'GET /api/v1/board',
  'GET /api/v1/dashboard',
  'GET /api/v1/events',
  'GET /api/v1/goals',
  'POST /api/v1/goals/{id}/approve',
  'POST /api/v1/goals/{id}/reject',
  'POST /api/v1/goals/{id}/subtasks',
  'GET /api/v1/me',
  'POST /api/v1/mcp',
  'GET /api/v1/organization',
  'PATCH /api/v1/organization',
  'PUT /api/v1/organization/pause',
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
  'POST /api/v1/runs/{runId}/authorize-tool',
  'GET /api/v1/schedules',
  'POST /api/v1/schedules',
  'GET /api/v1/schedules/preview',
  'GET /api/v1/schedules/{id}',
  'PATCH /api/v1/schedules/{id}',
  'DELETE /api/v1/schedules/{id}',
  'POST /api/v1/schedules/{id}/run-now',
  'GET /api/v1/schedules/{id}/tasks',
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
  'DELETE /api/v1/tasks/{id}',
  'POST /api/v1/tasks/start',
  'POST /api/v1/tasks/{id}/start',
  'POST /api/v1/tasks/{id}/cancel',
  'POST /api/v1/tasks/{id}/reorder',
  'GET /api/v1/tasks/{id}/tree',
  'GET /api/v1/teams',
  'POST /api/v1/teams',
  'POST /api/v1/teams/{teamId}/members',
  'GET /api/v1/users',
].sort();

describe('T12 API gaps', () => {
  it('returns policy rule origins and provider-specific enforcement without auditing reads', async () => {
    const { agent, account } = await seedAgent();
    const before = (await call('GET', '/audit')).json().items.length;
    const result = (await call('GET', `/agents/${agent.id}/effective-policy`)).json();
    expect(result.rules.maxMode).toMatchObject({
      value: 'edit',
      setBy: { level: 'org', version: 1 },
      coverage: 'cli-sandbox',
    });
    expect(result.rules.workDirs.coverageDetails).toContainEqual({
      mechanism: 'runtime-hook',
      scope: 'Paths in Claude Read/Edit/Write/Glob/Grep tool calls.',
    });
    expect((await call('GET', '/audit')).json().items).toHaveLength(before);
    expect(account.provider).toBe('claude');
  });

  it('returns effective skill origins, winning pins and policy exclusions', async () => {
    const { agent } = await seedAgent();
    const skill = (
      await call('POST', '/skills', {
        name: 'example',
        files: { 'SKILL.md': Buffer.from('# Example').toString('base64') },
      })
    ).json();
    await call('POST', '/skill-assignments', { skillId: skill.id, scope: { org: true } });
    await call('POST', '/skill-assignments', {
      skillId: skill.id,
      scope: { agentId: agent.id },
      pinnedVersion: 1,
    });
    const effective = (await call('GET', `/agents/${agent.id}/effective-skills`)).json();
    expect(effective.items).toHaveLength(1);
    expect(effective.items[0]).toMatchObject({ origin: { agentId: agent.id }, pinnedVersion: 1, version: 1 });
    expect(effective.excluded).toEqual([]);
    const policy = (
      await call('POST', '/policies', { name: 'no skills', rules: { allowedSkillIds: [] } })
    ).json();
    await call('PATCH', `/agents/${agent.id}`, { policyId: policy.id });
    const excluded = (await call('GET', `/agents/${agent.id}/effective-skills`)).json();
    expect(excluded.items).toEqual([]);
    expect(excluded.excluded[0]).toMatchObject({
      skillId: skill.id,
      origin: { agentId: agent.id },
      pinnedVersion: 1,
      reason: 'allowedSkillIds',
    });
  });

  it('sets group membership atomically, deduplicates and audits each actual change', async () => {
    const { agent } = await seedAgent();
    const a = (await call('POST', '/agent-groups', { name: 'a' })).json();
    const b = (await call('POST', '/agent-groups', { name: 'b' })).json();
    expect((await call('PATCH', `/agents/${agent.id}`, { groupIds: [a.id, a.id] })).json().groupIds).toEqual([
      a.id,
    ]);
    expect(
      (await call('PATCH', `/agents/${agent.id}`, { groupIds: [b.id], name: 'updated' })).json(),
    ).toMatchObject({ groupIds: [b.id], name: 'updated' });
    await call('PATCH', `/agents/${agent.id}`, { groupIds: [b.id] });
    const events = (await call('GET', '/audit?targetType=agent_group'))
      .json()
      .items.filter((e: { action: string }) => e.action.startsWith('agent_group.member_'));
    expect(events.map((e: { action: string }) => e.action)).toEqual([
      'agent_group.member_added',
      'agent_group.member_removed',
      'agent_group.member_added',
    ]);
    expect(
      (
        await call('PATCH', `/agents/${agent.id}`, {
          name: 'rollback',
          groupIds: [a.id, '00000000-0000-4000-8000-000000000000'],
        })
      ).status,
    ).toBe(404);
    expect((await call('GET', `/agents/${agent.id}`)).json()).toMatchObject({
      groupIds: [b.id],
      name: 'updated',
    });
    expect(
      (await call('GET', '/audit?targetType=agent_group'))
        .json()
        .items.filter((e: { action: string }) => e.action.startsWith('agent_group.member_')),
    ).toHaveLength(3);
    expect((await call('PATCH', `/agents/${agent.id}`, { groupIds: [] })).json().groupIds).toEqual([]);
  });

  it('rejects unauthorized membership changes without updating the agent', async () => {
    const { agent } = await seedAgent();
    const group = (await call('POST', '/agent-groups', { name: 'restricted' })).json();
    api.as(await api.makeUser('user:viewer-gaps', 'viewer'));
    expect((await call('PATCH', `/agents/${agent.id}`, { name: 'no', groupIds: [group.id] })).status).toBe(
      403,
    );
    api.as(null);
    expect((await call('GET', `/agents/${agent.id}`)).json()).toMatchObject({ name: 'alpha', groupIds: [] });
  });

  it('filters direct role bindings and skill assignments by both scope kinds', async () => {
    const { agent } = await seedAgent();
    const group = (await call('POST', '/agent-groups', { name: 'scope' })).json();
    const me = (await call('GET', '/me')).json();
    const skill = (
      await call('POST', '/skills', {
        name: 'scope-skill',
        files: { 'SKILL.md': Buffer.from('# Scope').toString('base64') },
      })
    ).json();
    for (const scope of [{ org: true }, { agentId: agent.id }, { agentGroupId: group.id }]) {
      await call('POST', '/role-bindings', { subject: { userId: me.id }, role: 'viewer', scope });
      await call('POST', '/skill-assignments', { skillId: skill.id, scope });
    }
    for (const [key, id] of [
      ['agentId', agent.id],
      ['agentGroupId', group.id],
    ]) {
      for (const path of ['/role-bindings', '/skill-assignments']) {
        const rows = (await call('GET', `${path}?${key}=${id}`)).json().items;
        expect(rows).toHaveLength(1);
        expect(rows[0].scope).toEqual({ [key]: id });
        expect(
          (await call('GET', `${path}?agentId=${agent.id}&agentGroupId=${group.id}`)).json().items,
        ).toEqual([]);
        expect((await call('GET', `${path}?${key}=bad`)).status).toBe(400);
      }
    }
  });

  it('restricts provider IDs and publishes flat account field schemas', async () => {
    const providers = (await call('GET', '/providers')).json().items;
    expect(providers.map((p: { id: string }) => p.id)).toEqual([
      'claude',
      'openai',
      'gemini',
      'openai_compatible',
    ]);
    expect(providers[3].accountFields).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        baseUrl: { type: 'string' },
        models: { type: 'array', items: { type: 'string' } },
        wireApi: { type: 'string' },
      },
    });
    expect(
      (await call('POST', '/accounts', { name: 'unknown', provider: 'unknown', type: 'cli' })).status,
    ).toBe(400);
    expect((await call('GET', '/accounts?provider=unknown')).status).toBe(400);
  });

  it('filters audit by actor OR target, preserving other filters and paging', async () => {
    const { agent } = await seedAgent();
    await call('PATCH', `/agents/${agent.id}`, { name: 'Changed' });
    const involved = (await call('GET', `/audit?involving=${agent.id}&limit=1`)).json();
    expect(involved.items).toHaveLength(1);
    expect(involved.items[0].action).toBe('agent.updated');
    const older = (await call('GET', `/audit?involving=${agent.id}&cursor=${involved.nextCursor}`)).json();
    expect(older.items.map((e: { action: string }) => e.action)).toEqual(['agent.created']);
    const me = (await call('GET', '/me')).json();
    const actorRows = (await call('GET', `/audit?involving=${me.id}&action=agent.updated`)).json().items;
    expect(actorRows).toHaveLength(1);
    expect(actorRows[0].actorId).toBe(me.id);
    expect((await call('GET', `/audit?involving=${agent.id}&action=account.created`)).json().items).toEqual(
      [],
    );
  });

  it.each(['initials', 'color', 'url'])(
    'round trips structured %s avatars and rejects free strings',
    async (kind) => {
      const { agent } = await seedAgent();
      const value = kind === 'url' ? 'https://example.com/avatar.png' : kind === 'color' ? 'av-3' : 'AB';
      const avatar = { kind, value };
      expect((await call('PATCH', `/agents/${agent.id}`, { avatar })).json().avatar).toEqual(avatar);
      expect((await call('GET', `/agents/${agent.id}`)).json().avatar).toEqual(avatar);
      expect((await call('PATCH', `/agents/${agent.id}`, { avatar: value })).status).toBe(400);
      expect(
        (
          await call('PATCH', `/agents/${agent.id}`, {
            avatar: { kind: 'url', value: 'javascript:alert(1)' },
          })
        ).status,
      ).toBe(400);
      expect((await call('PATCH', `/agents/${agent.id}`, { avatar: null })).json().avatar).toBeNull();
    },
  );

  it('accepts empty JSON for body-less POSTs and still rejects missing or malformed required bodies', async () => {
    const { agent } = await seedAgent();
    const schedule = (
      await call('POST', '/schedules', {
        name: 'empty',
        cron: '* * * * *',
        template: { title: 'Scheduled', prompt: 'Do it', target: { agentId: agent.id }, workDir: '/tmp' },
      })
    ).json();
    const run = await api.app.inject({
      method: 'POST',
      url: `/api/v1/schedules/${schedule.id}/run-now`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(run.statusCode, run.body).toBe(201);
    const task = JSON.parse(run.body) as { id: string };
    const cancelled = await api.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/cancel`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    for (const payload of ['', '{']) {
      const required = await api.app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(required.statusCode).toBe(400);
    }
    const malformed = await api.app.inject({
      method: 'POST',
      url: `/api/v1/schedules/${schedule.id}/run-now`,
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('reports all account availability reasons and includes dashboard feeds', async () => {
    const { agent, account } = await seedAgent();
    const dashboard = () => call('GET', '/dashboard');
    expect((await dashboard()).json().accounts[0].availabilityReason).toBe('ok');
    const run = await api.database.db.transaction((tx) =>
      api.c.runs.startRun(tx, api.c.dispatcher, {
        taskId: agent.id,
        agentId: agent.id,
        accountId: account.id,
        workerId: 'test',
        effectivePolicy: {},
        skills: [],
      }),
    );
    expect((await dashboard()).json().accounts[0].availabilityReason).toBe('concurrency_full');
    await api.database.db.transaction(async (tx) => {
      await api.c.runs.appendRunEvent(tx, api.c.dispatcher, run.id, {
        kind: 'usage',
        inputTokens: 3,
        outputTokens: 2,
        cachedTokens: 999,
      });
      await api.c.runs.finishRun(tx, api.c.dispatcher, run.id, { status: 'failed', error: 'test failure' });
    });
    await call('PATCH', `/accounts/${account.id}`, { limits: { dailyTokenBudget: 5, maxConcurrentRuns: 1 } });
    expect((await dashboard()).json().accounts[0].availabilityReason).toBe('budget_exhausted');
    await api.database.db.transaction((tx) =>
      api.c.usage.blockAccount(tx, api.c.dispatcher, account.id, new Date(Date.now() + 60000)),
    );
    const result = (await dashboard()).json();
    expect(result.accounts[0].availabilityReason).toBe('blocked');
    expect(result.recentFailures.map((r: { id: string }) => r.id)).toEqual([run.id]);
    expect(result.tokenBuckets).toHaveLength(24);
    expect(result.tokenBuckets.reduce((sum: number, b: { tokens: number }) => sum + b.tokens, 0)).toBe(5);
  });
});
