/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
let ws = '';
beforeEach(async () => {
  api = await makeApi();
  ws = (await call('GET', '/organization')).json().workspaceRoot;
});
afterEach(async () => {
  await api.close();
});

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await api.app.inject({ method, url: `/api/v1${url}`, payload: payload as object });
  return {
    status: res.statusCode,
    json: () => (res.body ? (JSON.parse(res.body) as Record<string, any>) : {}),
  };
}

async function seedTask(workDir?: string) {
  const account = await call('POST', '/accounts', {
    name: 'acc',
    provider: 'claude',
    type: 'cli',
    configDir: '/tmp/acc',
  });
  const agent = await call('POST', '/agents', { slug: 'alpha', name: 'alpha', accountId: account.json().id });
  const task = await call('POST', '/tasks', {
    title: 'T',
    prompt: 'p',
    ...(workDir ? { workDir } : {}),
    target: { agentId: agent.json().id },
  });
  return { agent: agent.json(), task: task.json() };
}

const fail = async (id: string, status: 'denied' | 'failed' | 'cancelled' | 'done' | 'rate_limited') => {
  const sys = api.c.dispatcher;
  const db = api.database.db;
  if (status === 'cancelled') {
    await call('POST', `/tasks/${id}/cancel`);
    return;
  }
  await db.transaction(async (tx) => {
    if (status === 'denied') await api.c.tasks.setTaskStatus(tx, sys, id, 'denied', 'no way');
    else if (status === 'done' || status === 'rate_limited') {
      await api.c.tasks.claimNextTask(tx, sys, 'w1');
      await api.c.tasks.setTaskStatus(tx, sys, id, 'running');
      await api.c.tasks.setTaskStatus(tx, sys, id, status);
    } else {
      await api.c.tasks.claimNextTask(tx, sys, 'w1');
      await api.c.tasks.setTaskStatus(tx, sys, id, 'failed', 'boom');
    }
  });
};

describe('POST /tasks/:id/to-backlog', () => {
  it('moves a denied task back to draft, clears the error and keeps workDir', async () => {
    const { task } = await seedTask(`${ws}/proj`);
    await fail(task.id, 'denied');
    expect((await call('GET', `/tasks/${task.id}`)).json()).toMatchObject({
      status: 'denied',
      error: 'no way',
    });
    const moved = await call('POST', `/tasks/${task.id}/to-backlog`);
    expect(moved.status).toBe(200);
    expect(moved.json()).toMatchObject({
      status: 'draft',
      error: null,
      runAt: null,
      resumeAt: null,
      attempt: 1,
      workDir: `${ws}/proj`,
    });
    const audit = (await call('GET', '/audit?action=task.to_backlog')).json();
    expect(audit.items).toHaveLength(1);
  });

  it('moves failed and cancelled tasks and rejects other states', async () => {
    const { task } = await seedTask();
    expect((await call('POST', `/tasks/${task.id}/to-backlog`)).status).toBe(409);
    await fail(task.id, 'cancelled');
    expect((await call('POST', `/tasks/${task.id}/to-backlog`)).json().status).toBe('draft');
    await call('POST', `/tasks/${task.id}/start`, {});
    await fail(task.id, 'failed');
    expect((await call('GET', `/tasks/${task.id}`)).json().status).toBe('failed');
    expect((await call('POST', `/tasks/${task.id}/to-backlog`)).json().status).toBe('draft');
  });

  it('is all or none in bulk and needs task.write', async () => {
    const { task } = await seedTask();
    await fail(task.id, 'cancelled');
    const other = (
      await call('POST', '/tasks', { title: 'Q', prompt: 'p', target: { agentId: task.target.agentId } })
    ).json();
    const bad = await call('POST', '/tasks/to-backlog', { ids: [task.id, other.id] });
    expect(bad.status).toBe(409);
    expect((await call('GET', `/tasks/${task.id}`)).json().status).toBe('cancelled');
    const ok = await call('POST', '/tasks/to-backlog', { ids: [task.id] });
    expect((ok.json().items as { status: string }[]).map((t) => t.status)).toEqual(['draft']);
    await fail(other.id, 'cancelled');
    api.as(await api.makeUser('user:viewer', 'viewer'));
    expect((await call('POST', `/tasks/${other.id}/to-backlog`)).status).toBe(403);
  });
});

const addRun = (taskId: string) =>
  api.database.db.transaction((tx) =>
    api.c.runs.startRun(
      tx,
      { ...api.c.localUser, kind: 'system' },
      {
        taskId,
        accountId: randomUUID(),
        agentId: randomUUID(),
        workerId: 'w1',
        effectivePolicy: {},
        skills: [],
      },
    ),
  );

describe('run again and duplicate', () => {
  it('moves a done task to the backlog', async () => {
    const { task } = await seedTask();
    await fail(task.id, 'done');
    expect((await call('POST', `/tasks/${task.id}/to-backlog`)).json().status).toBe('draft');
  });

  it('re-queues the same task, keeps its runs and audits', async () => {
    const { task } = await seedTask();
    await addRun(task.id);
    await fail(task.id, 'done');
    expect((await call('GET', `/tasks/${task.id}`)).json().runCount).toBe(1);
    const res = await call('POST', `/tasks/${task.id}/rerun`, {});
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({
      id: task.id,
      status: 'queued',
      error: null,
      result: null,
      attempt: 1,
      runCount: 1,
    });
    await addRun(task.id);
    expect((await call('GET', `/tasks/${task.id}`)).json().runCount).toBe(2);
    expect((await call('GET', `/runs?taskId=${task.id}`)).json().items).toHaveLength(2);
    expect((await call('GET', '/audit?action=task.rerun')).json().items).toHaveLength(1);
  });

  it('supports a scheduled start and rejects non-finished tasks', async () => {
    const { task } = await seedTask();
    expect((await call('POST', `/tasks/${task.id}/rerun`, {})).status).toBe(409);
    await fail(task.id, 'cancelled');
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const res = await call('POST', `/tasks/${task.id}/rerun`, { when: { mode: 'at', at } });
    expect(res.json()).toMatchObject({ status: 'scheduled', runAt: at });
  });

  it('is all or none in bulk and refuses goal tasks', async () => {
    const { task, agent } = await seedTask();
    await fail(task.id, 'done');
    const open = (
      await call('POST', '/tasks', { title: 'Q', prompt: 'p', target: { agentId: agent.id } })
    ).json();
    expect((await call('POST', '/tasks/rerun', { ids: [task.id, open.id] })).status).toBe(409);
    expect((await call('GET', `/tasks/${task.id}`)).json().status).toBe('done');
    const ok = await call('POST', '/tasks/rerun', { ids: [task.id] });
    expect((ok.json().items as { status: string }[]).map((t) => t.status)).toEqual(['queued']);
    const goal = await api.c.tasks.createTask(api.database.db, api.c.localUser, {
      title: 'G',
      prompt: 'p',
      kind: 'goal',
      target: { agentId: agent.id },
    });
    await fail(goal.id, 'cancelled');
    expect((await call('POST', `/tasks/${goal.id}/rerun`, {})).status).toBe(409);
    expect((await call('POST', `/tasks/${goal.id}/duplicate`)).status).toBe(409);
  });

  it('accepts string scheduling, validates runAt, and reruns every finished status', async () => {
    const { agent, task: seed } = await seedTask();
    await call('POST', `/tasks/${seed.id}/cancel`);
    for (const status of ['done', 'failed', 'denied', 'cancelled', 'rate_limited'] as const) {
      const task = (
        await call('POST', '/tasks', { title: 'R', prompt: 'p', target: { agentId: agent.id } })
      ).json();
      await fail(task.id, status);
      const res = await call('POST', `/tasks/${task.id}/rerun`, { when: 'now' });
      expect(res.status).toBe(200);
      expect(res.json().status).toBe('queued');
      await call('POST', `/tasks/${task.id}/cancel`);
    }
    const task = (
      await call('POST', '/tasks', { title: 'R', prompt: 'p', target: { agentId: agent.id } })
    ).json();
    await fail(task.id, 'done');
    expect((await call('POST', `/tasks/${task.id}/rerun`, { when: 'at' })).status).toBe(400);
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await call('POST', '/tasks/rerun', { ids: [task.id], when: 'at', runAt });
    expect(scheduled.status).toBe(200);
    expect(scheduled.json().items[0]).toMatchObject({ status: 'scheduled', runAt });
    await fail(task.id, 'cancelled');
    const now = await call('POST', `/tasks/${task.id}/rerun`, { when: 'limit_reset' });
    expect(now.json()).toMatchObject({ status: 'queued', runAt: null });
  });

  it('rejects goal subtasks atomically without auditing a rerun', async () => {
    const { task, agent } = await seedTask();
    await fail(task.id, 'done');
    const goal = await api.c.tasks.createTask(api.database.db, api.c.localUser, {
      title: 'G',
      prompt: 'p',
      kind: 'goal',
      target: { agentId: agent.id },
      draft: true,
    });
    const child = await api.database.db.transaction((tx) =>
      api.c.tasks.createChildTask(
        tx,
        api.c.localUser,
        {
          title: 'Child',
          prompt: 'p',
          workDir: goal.workDir,
          target: { agentId: agent.id },
        },
        { kind: 'task', rootTaskId: goal.id, parentTaskId: goal.id, depth: 1, dependsOn: [] },
      ),
    );
    await fail(child.id, 'cancelled');
    expect((await call('POST', `/tasks/${child.id}/rerun`, {})).status).toBe(409);
    expect((await call('POST', '/tasks/rerun', { ids: [task.id, child.id], when: 'now' })).status).toBe(409);
    expect((await call('GET', `/tasks/${task.id}`)).json().status).toBe('done');
    expect((await call('GET', '/audit?action=task.rerun')).json().items).toHaveLength(0);
  });

  it('allocates a new folder when copying a schedule-generated task', async () => {
    const { task } = await seedTask();
    const schedule = await call('POST', '/schedules', {
      name: 'Nightly',
      cron: '0 2 * * *',
      template: { title: 'Nightly', prompt: 'p', target: task.target },
    });
    expect(schedule.status).toBe(201);
    const original = await call('POST', `/schedules/${schedule.json().id}/run-now`);
    expect(original.status).toBe(201);
    expect(original.json().workDir).not.toBe(`${ws}/${original.json().key}`);
    const copy = await call('POST', `/tasks/${original.json().id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json()).toMatchObject({ status: 'draft', scheduleId: null });
    expect(copy.json().workDir).toBe(`${ws}/${copy.json().key}`);
    expect(copy.json().workDir).not.toBe(original.json().workDir);
  });

  it('allocates automatic copies under the updated workspace root', async () => {
    const { task } = await seedTask();
    const workspaceRoot = `${ws}/new-root`;
    expect((await call('PATCH', '/organization', { workspaceRoot })).status).toBe(200);
    const copy = await call('POST', `/tasks/${task.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json().workDir).toBe(`${workspaceRoot}/${copy.json().key}`);
    expect(copy.json().workDir).not.toBe(task.workDir);
  });

  it('preserves a folder explicitly set while editing an automatic draft', async () => {
    const { task } = await seedTask();
    const draft = await call('POST', '/tasks', {
      title: 'Draft',
      prompt: 'p',
      target: task.target,
      draft: true,
    });
    const workDir = draft.json().workDir;
    expect((await call('PATCH', `/tasks/${draft.json().id}`, { workDir })).status).toBe(200);
    const copy = await call('POST', `/tasks/${draft.json().id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json().workDir).toBe(workDir);
  });

  it('duplicates into a draft with a new auto folder or the same explicit one', async () => {
    const { task } = await seedTask();
    await call('PATCH', `/tasks/${task.id}`, { priority: 0 });
    const copy = await call('POST', `/tasks/${task.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json()).toMatchObject({
      status: 'draft',
      title: 'T (copy)',
      prompt: 'p',
      priority: 0,
      dependsOn: [],
      target: task.target,
    });
    expect(copy.json().id).not.toBe(task.id);
    expect(copy.json().workDir).not.toBe(task.workDir);
    const explicit = (
      await call('POST', '/tasks', { title: 'E', prompt: 'p', workDir: `${ws}/proj`, target: task.target })
    ).json();
    const same = await call('POST', `/tasks/${explicit.id}/duplicate`);
    expect(same.json().workDir).toBe(`${ws}/proj`);
    expect((await call('GET', '/audit?action=task.duplicate')).json().items).toHaveLength(2);
  });
});

describe('work directory policy check', () => {
  it('rejects an absolute folder outside the agent policy with a workDir detail', async () => {
    const { agent } = await seedTask();
    const res = await call('POST', '/tasks', {
      title: 'X',
      prompt: 'p',
      workDir: '/etc/elsewhere',
      target: { agentId: agent.id },
    });
    expect(res.status).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'work_dir_outside_policy',
      details: [{ path: 'workDir' }],
    });
  });

  it('checks the folder when a backlog task is edited', async () => {
    const { task } = await seedTask();
    const draft = (
      await call('POST', '/tasks', { title: 'D', prompt: 'p', draft: true, target: task.target })
    ).json();
    const res = await call('PATCH', `/tasks/${draft.id}`, { workDir: '/etc/elsewhere' });
    expect(res.status).toBe(422);
    expect(res.json().code).toBe('work_dir_outside_policy');
  });
});
