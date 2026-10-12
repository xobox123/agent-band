/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  await api.close();
});

async function call(method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await api.app.inject({ method, url: `/api/v1${url}`, payload: payload as object });
  return { status: res.statusCode, json: () => JSON.parse(res.body) as Record<string, any> };
}

async function seed() {
  const account = await call('POST', '/accounts', {
    name: 'retarget-account',
    provider: 'claude',
    type: 'cli',
    configDir: '/tmp/retarget-account',
  });
  const agent = await call('POST', '/agents', {
    slug: 'first',
    name: 'First',
    accountId: account.json().id,
  });
  const task = await call('POST', '/tasks', {
    title: 'Queued work',
    prompt: 'run',
    target: { agentId: agent.json().id },
  });
  return { task: task.json(), agent: agent.json() };
}

describe('POST /tasks/:id/retarget', () => {
  it('changes to an agent, group or label and audits the old and new targets', async () => {
    const { task } = await seed();
    const label = await call('POST', `/tasks/${task.id}/retarget`, { target: { label: 'frontend' } });
    expect(label.status).toBe(200);
    expect(label.json()).toMatchObject({ target: { label: 'frontend' }, status: 'queued' });
    const group = await call('POST', `/tasks/${task.id}/retarget`, {
      target: { agentGroupId: '00000000-0000-4000-8000-000000000001' },
    });
    expect(group.status).toBe(200);
    expect(group.json().target).toHaveProperty('agentGroupId');
    const audit = await call('GET', '/audit?action=task.retarget');
    expect(audit.json().items).toHaveLength(2);
    expect(audit.json().items[0].data).toMatchObject({
      oldTarget: { label: 'frontend' },
      newTarget: { agentGroupId: '00000000-0000-4000-8000-000000000001' },
    });
  });

  it('rejects malformed targets and tasks already claimed by the worker', async () => {
    const { task } = await seed();
    expect((await call('POST', `/tasks/${task.id}/retarget`, { target: {} })).status).toBe(400);
    await api.database.db.transaction((tx) =>
      api.c.tasks.claimNextTask(tx, api.c.dispatcher, 'worker'),
    );
    const conflict = await call('POST', `/tasks/${task.id}/retarget`, { target: { label: 'other' } });
    expect(conflict.status).toBe(409);
    expect(conflict.json().code).toBe('task_not_retargetable');
  });

  it('requires org owner even if an operator can edit tasks', async () => {
    const { task } = await seed();
    api.as(await api.makeUser('operator-retarget', 'operator'));
    const denied = await call('POST', `/tasks/${task.id}/retarget`, { target: { label: 'other' } });
    expect(denied.status).toBe(403);
    api.as(null);
    expect((await call('GET', `/tasks/${task.id}`)).json().target).toEqual(task.target);
  });
});
