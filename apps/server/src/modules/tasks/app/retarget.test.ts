import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createTasks } from '../index.ts';
import { tasks } from '../infra/schema.ts';

let database: Database;
let deps: ReturnType<typeof fakeDeps>;
let service: ReturnType<typeof createTasks>;
const owner = testActor();
const dispatcher = { ...owner, kind: 'system' as const };
const initial = { title: 'Move me', prompt: 'Do the work', workDir: '/work', target: { label: 'blocked' } };

beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  service = createTasks({ ...deps, orgSettings: new FakeOrgSettings() });
});
afterEach(async () => {
  await database.close();
});

describe('retargetTask', () => {
  it('updates the target, clears eligibility immediately and records old and new targets', async () => {
    const task = await service.createTask(database.db, owner, initial);
    await database.db
      .update(tasks)
      .set({
      eligibility: {
        reason: 'account unavailable',
        checkedAt: new Date().toISOString(),
        nextCheckAt: new Date(Date.now() + 600000).toISOString(),
        checks: 2,
      },
        error: 'no eligible agent',
      })
      .where(eq(tasks.id, task.id));
    const target = { agentId: randomUUID() };
    const moved = await service.retargetTask(database.db, owner, task.id, target);
    expect(moved).toMatchObject({
      target,
      status: 'queued',
      eligibility: null,
      error: null,
      workDir: task.workDir,
      branch: task.branch,
    });
    expect(deps.audit.entries.at(-1)).toMatchObject({
      action: 'task.retarget',
      targetId: task.id,
      data: { oldTarget: initial.target, newTarget: target },
    });
  });

  it('keeps a scheduled start time and the project worktree metadata', async () => {
    const at = new Date(Date.now() + 600000);
    const task = await service.createTask(database.db, owner, { ...initial, runAt: at });
    const projectId = randomUUID();
    await database.db
      .update(tasks)
      .set({
        projectId,
      branch: 'ab/AB-128',
        baseBranch: 'main',
      })
      .where(eq(tasks.id, task.id));
    const moved = await service.retargetTask(database.db, owner, task.id, { label: 'free' });
    expect(moved).toMatchObject({
      status: 'scheduled',
      projectId,
      branch: 'ab/AB-128',
      baseBranch: 'main',
      workDir: task.workDir,
    });
    expect(moved.runAt?.getTime()).toBe(at.getTime());
  });

  it('requeues failed tasks without dropping their worktree or changing the task id', async () => {
    const task = await service.createTask(database.db, owner, initial);
    await database.db
      .update(tasks)
      .set({ status: 'failed', attempt: 3, error: 'crashed' })
      .where(eq(tasks.id, task.id));
    const moved = await service.retargetTask(database.db, owner, task.id, { label: 'recovery' });
    expect(moved).toMatchObject({
      id: task.id,
      status: 'queued',
      attempt: 1,
      error: null,
      workDir: task.workDir,
    });
  });

  it('fails with 409 if the worker claimed first, but claim sees the new target if retarget won', async () => {
    const claimedFirst = await service.createTask(database.db, owner, initial);
    await database.db.transaction((tx) => service.claimNextTask(tx, dispatcher, 'w1'));
    await expect(
      service.retargetTask(database.db, owner, claimedFirst.id, { label: 'new' }),
    ).rejects.toMatchObject({ status: 409, code: 'task_not_retargetable' });
    const retargetFirst = await service.createTask(database.db, owner, initial);
    await service.retargetTask(database.db, owner, retargetFirst.id, { label: 'new' });
    const claimed = await database.db.transaction((tx) => service.claimNextTask(tx, dispatcher, 'w2'));
    expect(claimed).toMatchObject({ id: retargetFirst.id, target: { label: 'new' } });
  });

  it('does not mutate tasks if actor lacks owner permission or status is not permitted', async () => {
    const task = await service.createTask(database.db, owner, initial);
    deps.authorizer.deny = (action) => action === 'org.manage';
    await expect(service.retargetTask(database.db, owner, task.id, { label: 'other' })).rejects.toMatchObject({
      status: 403,
    });
    deps.authorizer.deny = null;
    await database.db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, task.id));
    await expect(service.retargetTask(database.db, owner, task.id, { label: 'other' })).rejects.toMatchObject({
      status: 409,
    });
    expect((await service.getTask(database.db, owner, task.id)).target).toEqual(initial.target);
  });
});
