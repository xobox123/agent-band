import { beforeEach, afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { outboxEvents } from '../../../platform/schema.ts';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createTasks } from '../index.ts';
import { tasks } from '../infra/schema.ts';
let database: Database;
const actor = testActor();
const system = { ...actor, kind: 'system' as const };
let deps: ReturnType<typeof fakeDeps>;
let api: ReturnType<typeof createTasks>;
const input = { title: 'Task', prompt: 'Do it', workDir: '/work', target: { label: 'backend' } };
beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  api = createTasks({ ...deps, orgSettings: new FakeOrgSettings() });
});
afterEach(async () => {
  await database.close();
});
it('allocates sequential unique keys under parallel transactions, independently per org', async () => {
  const result = await Promise.all(
    Array.from({ length: 10 }, () => api.createTask(database.db, actor, input)),
  );
  expect(result.map((t) => Number(t.key.split('-')[1])).sort((a, b) => a - b)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
  expect(new Set(result.map((t) => t.id)).size).toBe(10);
  expect((await api.createTask(database.db, testActor(), input)).key).toBe('AB-1');
});
it('two parallel claimers use separate transactions and never claim the same task', async () => {
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      api.createTask(database.db, actor, { ...input, priority: i % 4, rank: 10 - i }),
    ),
  );
  async function worker(id: string) {
    const claimed: string[] = [];
    for (;;) {
      const task = await database.db.transaction((tx) => api.claimNextTask(tx, system, id));
      if (!task) break;
      claimed.push(task.id);
    }
    return claimed;
  }
  const [a, b] = await Promise.all([worker('a'), worker('b')]);
  expect(a.length + b.length).toBe(10);
  expect(new Set([...a, ...b]).size).toBe(10);
  expect((await api.listTasks(database.db, actor)).every((t) => t.status === 'claimed')).toBe(true);
});
it('claims P0 first, then rank and creation time; release preserves queued reason', async () => {
  await api.createTask(database.db, actor, { ...input, priority: 3 });
  const first = await api.createTask(database.db, actor, { ...input, priority: 0, rank: -1 });
  await api.createTask(database.db, actor, { ...input, priority: 0, rank: 1 });
  const claimed = await database.db.transaction((tx) => api.claimNextTask(tx, system, 'worker'));
  expect(claimed?.id).toBe(first.id);
  const released = await database.db.transaction((tx) =>
    api.releaseTask(tx, system, first.id, 'no eligible agent'),
  );
  expect(released.status).toBe('queued');
  expect(released.error).toBe('no eligible agent');
});
it('groups all board statuses, including claimed and denied', async () => {
  for (const status of [
    'scheduled',
    'queued',
    'claimed',
    'running',
    'done',
    'failed',
    'rate_limited',
    'cancelled',
    'denied',
  ] as const) {
    const t = await api.createTask(database.db, actor, input);
    await database.db.update(tasks).set({ status }).where(eq(tasks.id, t.id));
  }
  const board = await api.boardView(database.db, actor);
  expect(Object.fromEntries(Object.entries(board).map(([k, v]) => [k, v.length]))).toEqual({
    draft: 0,
    scheduled: 1,
    queued: 1,
    running: 2,
    rate_limited: 1,
    done: 1,
    failed: 2,
    cancelled: 1,
  });
});
it('reorders ranks only, supports tied ranks and end placement, rejects nonqueued or different priority', async () => {
  const a = await api.createTask(database.db, actor, input);
  const b = await api.createTask(database.db, actor, input);
  const c = await api.createTask(database.db, actor, input);
  await api.reorderTask(database.db, actor, c.id, a.id);
  expect((await api.listTasks(database.db, actor)).map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  await api.reorderTask(database.db, actor, c.id);
  expect((await api.listTasks(database.db, actor)).map((t) => t.id)).toEqual([a.id, b.id, c.id]);
  expect((await api.listTasks(database.db, actor)).map((t) => t.priority)).toEqual([2, 2, 2]);
  const p0 = await api.createTask(database.db, actor, { ...input, priority: 0 });
  await expect(api.reorderTask(database.db, actor, a.id, p0.id)).rejects.toMatchObject({
    code: 'invalid_reorder_target',
  });
  await api.cancelTask(database.db, actor, a.id);
  await expect(api.reorderTask(database.db, actor, a.id)).rejects.toMatchObject({ code: 'task_not_queued' });
});
it('authorizes target agent, prevents writes on denial, isolates orgs and requires system for claim', async () => {
  const agentId = testActor().principalId;
  deps.authorizer.deny = (action) => action === 'task.write';
  await expect(api.createTask(database.db, actor, { ...input, target: { agentId } })).rejects.toMatchObject({
    status: 403,
  });
  expect(deps.authorizer.checks.at(-1)?.resource).toEqual({ agentId });
  expect(await api.listTasks(database.db, actor)).toEqual([]);
  deps.authorizer.deny = null;
  const task = await api.createTask(database.db, actor, input);
  expect(await api.listTasks(database.db, testActor())).toEqual([]);
  await expect(api.cancelTask(database.db, testActor(), task.id)).rejects.toMatchObject({ status: 404 });
  await expect(database.db.transaction((tx) => api.claimNextTask(tx, actor, 'bad'))).rejects.toMatchObject({
    status: 403,
  });
});
it('rolls back task, key counter and outbox if audit fails', async () => {
  const broken = createTasks({
    ...deps,
    orgSettings: new FakeOrgSettings(),
    audit: { append: () => Promise.reject(new Error('audit failed')) },
  });
  await expect(broken.createTask(database.db, actor, input)).rejects.toThrow('audit failed');
  expect(await database.db.select().from(outboxEvents)).toEqual([]);
  expect((await api.createTask(database.db, actor, input)).key).toBe('AB-1');
  expect(deps.audit.entries.some((e) => e.action === 'task.create')).toBe(true);
});
it('publishes changes, filters lists, and rejects terminal transitions', async () => {
  const task = await api.createTask(database.db, actor, input);
  expect((await api.listTasks(database.db, actor, { text: task.key, label: 'backend' })).length).toBe(1);
  await api.cancelTask(database.db, actor, task.id);
  await expect(api.cancelTask(database.db, actor, task.id)).rejects.toMatchObject({ code: 'task_terminal' });
  await expect(
    database.db.transaction((tx) => api.setTaskStatus(tx, system, task.id, 'running')),
  ).rejects.toMatchObject({ code: 'invalid_task_transition' });
  expect((await database.db.select().from(outboxEvents)).map((e) => e.type)).toEqual([
    'task.updated',
    'task.updated',
  ]);
});
it('requests cancellation of active tasks and skips excluded tasks when claiming', async () => {
  const a = await api.createTask(database.db, actor, input);
  const b = await api.createTask(database.db, actor, input);
  const claimed = await database.db.transaction((tx) =>
    api.claimNextTask(tx, system, 'w', { excludeTaskIds: [a.id] }),
  );
  expect(claimed?.id).toBe(b.id);
  await api.cancelTask(database.db, actor, a.id);
  expect((await database.db.select().from(outboxEvents)).map((e) => e.type)).not.toContain(
    'task.cancel_requested',
  );
  await api.cancelTask(database.db, actor, b.id);
  const event = (await database.db.select().from(outboxEvents)).find(
    (e) => e.type === 'task.cancel_requested',
  );
  expect(event?.payload).toEqual({ orgId: actor.orgId, taskId: b.id, previousStatus: 'claimed' });
});
it('writes no audit rows for list calls', async () => {
  await api.createTask(database.db, actor, input);
  deps.audit.entries.length = 0;
  await api.listTasks(database.db, actor);
  expect(deps.audit.entries).toEqual([]);
});
it('creates a scheduled task for a future runAt and rejects a past one', async () => {
  const future = new Date(Date.now() + 3_600_000);
  const task = await api.createTask(database.db, actor, { ...input, runAt: future, maxAttempts: 5 });
  expect(task).toMatchObject({ status: 'scheduled', attempt: 1, maxAttempts: 5, resumeAt: null });
  expect(task.runAt?.getTime()).toBe(future.getTime());
  await expect(
    api.createTask(database.db, actor, { ...input, runAt: new Date(Date.now() - 1000) }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await api.createTask(database.db, actor, input)).toMatchObject({ status: 'queued', runAt: null });
});
it('never claims scheduled tasks', async () => {
  await api.createTask(database.db, actor, { ...input, runAt: new Date(Date.now() + 3_600_000) });
  expect(await database.db.transaction((tx) => api.claimNextTask(tx, system, 'w'))).toBeNull();
});
it('cancelling a scheduled or rate limited task clears runAt and resumeAt', async () => {
  const scheduled = await api.createTask(database.db, actor, {
    ...input,
    runAt: new Date(Date.now() + 3_600_000),
  });
  const limited = await api.createTask(database.db, actor, input);
  await database.db
    .update(tasks)
    .set({ status: 'rate_limited', resumeAt: new Date(Date.now() + 1000) })
    .where(eq(tasks.id, limited.id));
  expect(await api.cancelTask(database.db, actor, scheduled.id)).toMatchObject({
    status: 'cancelled',
    runAt: null,
  });
  expect(await api.cancelTask(database.db, actor, limited.id)).toMatchObject({
    status: 'cancelled',
    resumeAt: null,
  });
});
it('stores resumeAt when a running task becomes rate limited', async () => {
  const task = await api.createTask(database.db, actor, input);
  await database.db.transaction(async (tx) => {
    await api.claimNextTask(tx, system, 'w');
    await api.setTaskStatus(tx, system, task.id, 'running');
    const resumeAt = new Date('2026-01-01T00:00:00Z');
    const limited = await api.setTaskStatus(tx, system, task.id, 'rate_limited', 'limit', { resumeAt });
    expect(limited.resumeAt?.getTime()).toBe(resumeAt.getTime());
  });
});
it('filters tasks by schedule id', async () => {
  const scheduleId = '00000000-0000-4000-8000-000000000009';
  await api.createTask(database.db, actor, { ...input, scheduleId });
  await api.createTask(database.db, actor, input);
  expect(await api.listTasks(database.db, actor, { scheduleId })).toHaveLength(1);
});
