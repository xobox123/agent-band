/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardDto, TaskDto, TaskList } from '@agent-band/contracts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  await api.close();
});
const call = (method: string, path: string, payload?: unknown) =>
  api.app.inject({ method: method as 'GET', url: `/api/v1${path}`, ...(payload ? { payload } : {}) });
const body = { title: 'T', prompt: 'p', target: { label: 'x' } };
const actions = async () =>
  ((await call('GET', '/audit?limit=200')).json().items as { action: string }[]).map((e) => e.action);

async function agentWithAccount(slug = 'a1', labels: string[] = ['x']) {
  const acc = await api.c.accounts.createAccount(api.database.db, api.c.localUser, {
    name: `acc-${slug}`,
    provider: 'claude',
    type: 'cli',
  });
  const agent = await api.c.agents.createAgent(api.database.db, api.c.localUser, {
    slug,
    name: slug,
    accountId: acc.id,
    labels,
  });
  return { acc, agent };
}

describe('backlog endpoints', () => {
  it('creates a draft with a default workspace folder, edits it, starts it and deletes another', async () => {
    const created = await call('POST', '/tasks', { ...body, draft: true });
    expect(created.statusCode).toBe(201);
    const t = TaskDto.parse(created.json());
    const org = (await call('GET', '/organization')).json();
    expect(t.status).toBe('draft');
    expect(t.workDir).toBe(`${org.workspaceRoot}/${t.key}`);
    expect(existsSync(t.workDir)).toBe(true);

    const edited = await call('PATCH', `/tasks/${t.id}`, {
      title: 'Renamed',
      runAt: null,
      mode: 'read-only',
    });
    expect(edited.json()).toMatchObject({ title: 'Renamed', mode: 'read-only', status: 'draft' });

    const board = BoardDto.parse((await call('GET', '/board?limit=10')).json());
    expect(board.columns.draft.map((x) => x.id)).toEqual([t.id]);

    const started = await call('POST', `/tasks/${t.id}/start`, {});
    expect(started.json()).toMatchObject({ status: 'queued' });
    const queuedEdit = await call('PATCH', `/tasks/${t.id}`, { title: 'again' });
    expect(queuedEdit.statusCode).toBe(409);
    expect((await call('PATCH', `/tasks/${t.id}`, { priority: 0 })).json().priority).toBe(0);

    const other = TaskDto.parse((await call('POST', '/tasks', { ...body, draft: true })).json());
    expect((await call('DELETE', `/tasks/${other.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/tasks/${t.id}`)).statusCode).toBe(409);
    expect(await actions()).toEqual(expect.arrayContaining(['task.update', 'task.start', 'task.delete']));
  });

  it('bulk start is atomic', async () => {
    const a = TaskDto.parse((await call('POST', '/tasks', { ...body, draft: true })).json());
    const b = TaskDto.parse((await call('POST', '/tasks', { ...body, draft: true })).json());
    const q = TaskDto.parse((await call('POST', '/tasks', body)).json());
    const bad = await call('POST', '/tasks/start', { ids: [a.id, b.id, q.id] });
    expect(bad.statusCode).toBe(409);
    expect((await call('GET', `/tasks/${a.id}`)).json().status).toBe('draft');
    const ok = TaskList.parse((await call('POST', '/tasks/start', { ids: [a.id, b.id] })).json());
    expect(ok.items.map((x) => x.status)).toEqual(['queued', 'queued']);
  });

  it('start at schedules the task and rejects a past time', async () => {
    const t = TaskDto.parse((await call('POST', '/tasks', { ...body, draft: true })).json());
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const res = await call('POST', `/tasks/${t.id}/start`, { when: { mode: 'at', at } });
    expect(res.json()).toMatchObject({ status: 'scheduled', startAfterReset: false });
    expect(new Date(res.json().runAt).toISOString()).toBe(at);
    const t2 = TaskDto.parse((await call('POST', '/tasks', { ...body, draft: true })).json());
    const past = await call('POST', `/tasks/${t2.id}/start`, {
      when: { mode: 'at', at: new Date(Date.now() - 1000).toISOString() },
    });
    expect(past.statusCode).toBe(400);
  });

  it('start when limits reset uses the earliest reset among candidate accounts', async () => {
    const one = await agentWithAccount('a1');
    const two = await agentWithAccount('a2');
    const soon = new Date(Date.now() + 2 * 3_600_000);
    const later = new Date(Date.now() + 5 * 3_600_000);
    await api.database.db.transaction(async (tx) => {
      await api.c.usage.recordWindows(tx, api.c.dispatcher, one.acc.id, [
        { window: '5h', usedPercent: 99, resetsAt: later.toISOString() },
      ]);
      await api.c.usage.recordWindows(tx, api.c.dispatcher, two.acc.id, [
        { window: '5h', usedPercent: 80, resetsAt: soon.toISOString() },
        { window: 'weekly', usedPercent: 10, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
      ]);
    });
    const t = TaskDto.parse((await call('POST', '/tasks', { ...body, draft: true })).json());
    const res = await call('POST', `/tasks/${t.id}/start`, { when: { mode: 'limit_reset' } });
    expect(res.json()).toMatchObject({ status: 'scheduled', startAfterReset: true });
    expect(new Date(res.json().runAt).toISOString()).toBe(soon.toISOString());

    const single = TaskDto.parse(
      (await call('POST', '/tasks', { ...body, target: { agentId: one.agent.id }, draft: true })).json(),
    );
    const s = await call('POST', `/tasks/${single.id}/start`, { when: { mode: 'limit_reset' } });
    expect(new Date(s.json().runAt).toISOString()).toBe(later.toISOString());
  });

  it('start when limits reset behaves like start now without a usage snapshot', async () => {
    const { agent } = await agentWithAccount('a3');
    const t = TaskDto.parse(
      (await call('POST', '/tasks', { ...body, target: { agentId: agent.id }, draft: true })).json(),
    );
    const res = await call('POST', `/tasks/${t.id}/start`, { when: { mode: 'limit_reset' } });
    expect(res.json()).toMatchObject({ status: 'queued', startAfterReset: false, runAt: null });
  });
});

describe('pause endpoints', () => {
  it('pause and resume the organization, an account and an agent, audited', async () => {
    const { acc, agent } = await agentWithAccount('p1');
    const org = await call('PUT', '/organization/pause', { paused: true });
    expect(org.json().paused).toBe(true);
    expect((await call('PUT', `/accounts/${acc.id}/pause`, { paused: true })).json().paused).toBe(true);
    expect((await call('PUT', `/agents/${agent.id}/pause`, { paused: true })).json().paused).toBe(true);
    expect((await call('GET', `/agents/${agent.id}`)).json().paused).toBe(true);
    await call('PUT', '/organization/pause', { paused: false });
    await call('PUT', `/accounts/${acc.id}/pause`, { paused: false });
    await call('PUT', `/agents/${agent.id}/pause`, { paused: false });
    expect(await actions()).toEqual(
      expect.arrayContaining([
        'org.pause',
        'org.resume',
        'account.pause',
        'account.resume',
        'agent.pause',
        'agent.resume',
      ]),
    );
  });

  it('requires management rights', async () => {
    const viewer = await api.makeUser('user:v', 'viewer');
    api.as(viewer);
    expect((await call('PUT', '/organization/pause', { paused: true })).statusCode).toBe(403);
  });
});

describe('organization workspace root', () => {
  it('can be changed and the new folder is created', async () => {
    const org = (await call('GET', '/organization')).json();
    const next = `${org.workspaceRoot}-next`;
    const res = await call('PATCH', '/organization', { workspaceRoot: next });
    expect(res.json().workspaceRoot).toBe(next);
    expect(existsSync(next)).toBe(true);
    expect((await call('PATCH', '/organization', { workspaceRoot: 'relative' })).statusCode).toBe(400);
  });
});

describe('goal plan endpoints', () => {
  it('approve and reject require a goal awaiting approval', async () => {
    const { agent } = await agentWithAccount('lead', []);
    await call('PATCH', `/agents/${agent.id}`, { role: 'leader' });
    const goal = TaskDto.parse(
      (
        await call('POST', '/tasks', {
          ...body,
          kind: 'goal',
          target: { agentId: agent.id },
          approval: 'required',
        })
      ).json(),
    );
    expect((await call('POST', `/goals/${goal.id}/approve`, {})).statusCode).toBe(409);
    expect((await call('POST', `/goals/${goal.id}/reject`, { feedback: 'x' })).statusCode).toBe(409);
    const tree = (await call('GET', `/tasks/${goal.id}/tree`)).json();
    expect(tree.goal).toMatchObject({ approval: 'required', status: 'planning' });
  });
});

describe('schedules', () => {
  it('default to a folder named after the schedule under the workspace root', async () => {
    const org = (await call('GET', '/organization')).json();
    const created = await call('POST', '/schedules', {
      name: 'Nightly Build',
      cron: '0 3 * * *',
      template: { title: 'n', prompt: 'p', target: { label: 'x' } },
    });
    expect(created.statusCode).toBe(201);
    const run = await call('POST', `/schedules/${created.json().id}/run-now`);
    const task = run.json();
    expect(task.workDir).toBe(`${org.workspaceRoot}/nightly-build`);
    expect(existsSync(task.workDir)).toBe(true);
  });
});
