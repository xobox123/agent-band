/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
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

const fail = async (id: string, status: 'denied' | 'failed' | 'cancelled') => {
  const sys = api.c.dispatcher;
  const db = api.database.db;
  if (status === 'cancelled') {
    await call('POST', `/tasks/${id}/cancel`);
    return;
  }
  await db.transaction(async (tx) => {
    if (status === 'denied') await api.c.tasks.setTaskStatus(tx, sys, id, 'denied', 'no way');
    else {
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
