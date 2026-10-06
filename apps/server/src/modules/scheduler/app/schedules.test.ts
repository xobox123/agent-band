import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createTasks } from '../../tasks/index.ts';
import { tasks } from '../../tasks/infra/schema.ts';
import { createScheduler } from '../index.ts';
import { schedules } from '../infra/schema.ts';

let database: Database;
let deps: ReturnType<typeof fakeDeps>;
let now: Date;
const user = testActor();
const system = { ...user, kind: 'system' as const };
const template = {
  title: 'Nightly',
  prompt: 'Run the nightly job',
  workDir: '/work/repo',
  target: { label: 'backend' },
  priority: 1,
};

function build(timezone = 'UTC') {
  const taskApi = createTasks({
    ...deps,
    orgSettings: new FakeOrgSettings({ taskKeyPrefix: 'AB', timezone }),
    now: () => now,
  });
  const scheduler = createScheduler({
    ...deps,
    orgSettings: new FakeOrgSettings({ taskKeyPrefix: 'AB', timezone }),
    now: () => now,
    tasks: {
      createTask: (tx, actor, input) => taskApi.createTaskIn(tx, actor, input),
      hasOpenTaskOfSchedule: (tx, actor, id) => taskApi.hasOpenTaskOfSchedule(tx, actor, id),
      releaseDueScheduled: (tx, actor, at) => taskApi.releaseDueScheduled(tx, actor, at),
      resumeDueRateLimited: (tx, actor, at) => taskApi.resumeDueRateLimited(tx, actor, at),
    },
  });
  return { taskApi, scheduler };
}

let api: ReturnType<typeof build>;
const at = (iso: string) => new Date(iso);
const tick = (when: string) => api.scheduler.tick(database.db, system, at(when));
const actions = () => deps.audit.entries.map((e) => e.action);
const allTasks = () => database.db.select().from(tasks);

beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  now = at('2026-01-05T10:00:00Z');
  api = build();
});
afterEach(async () => {
  await database.close();
});

describe('schedule use cases', () => {
  it('creates, reads, updates and deletes a schedule with audit and authorization', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'Nightly',
      cron: '0 2 * * *',
      template,
    });
    expect(s).toMatchObject({ enabled: true, overlap: 'skip', timezone: null, lastFiredAt: null });
    expect(s.nextFireAt.toISOString()).toBe('2026-01-06T02:00:00.000Z');
    expect((await api.scheduler.getSchedule(database.db, user, s.id)).id).toBe(s.id);
    expect(await api.scheduler.listSchedules(database.db, user)).toHaveLength(1);

    const moved = await api.scheduler.updateSchedule(database.db, user, s.id, {
      cron: '0 4 * * *',
      timezone: 'Europe/Warsaw',
      overlap: 'queue',
    });
    expect(moved.nextFireAt.toISOString()).toBe('2026-01-06T03:00:00.000Z');
    expect(moved.overlap).toBe('queue');
    const renamed = await api.scheduler.updateSchedule(database.db, user, s.id, { name: 'Other' });
    expect(renamed.nextFireAt.toISOString()).toBe('2026-01-06T03:00:00.000Z');

    await api.scheduler.deleteSchedule(database.db, user, s.id);
    await expect(api.scheduler.getSchedule(database.db, user, s.id)).rejects.toMatchObject({ status: 404 });
    expect(actions()).toEqual(['schedule.create', 'schedule.update', 'schedule.update', 'schedule.delete']);
    expect(deps.authorizer.checks.map((c) => c.action)).toContain('task.write');
    expect(deps.authorizer.checks.map((c) => c.action)).toContain('read');
  });

  it('does not audit reads', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '* * * * *',
      template,
    });
    const before = actions().length;
    await api.scheduler.getSchedule(database.db, user, s.id);
    await api.scheduler.listSchedules(database.db, user);
    await api.scheduler.preview(database.db, user, '* * * * *');
    expect(actions()).toHaveLength(before);
  });

  it('rejects an invalid cron or time zone on create and update', async () => {
    for (const cron of ['* * * *', 'nope', '0 0 * * * *'])
      await expect(
        api.scheduler.createSchedule(database.db, user, { name: 'n', cron, template }),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      api.scheduler.createSchedule(database.db, user, {
        name: 'n',
        cron: '* * * * *',
        timezone: 'Mars/Base',
        template,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '* * * * *',
      template,
    });
    await expect(
      api.scheduler.updateSchedule(database.db, user, s.id, { cron: '99 * * * *' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      api.scheduler.updateSchedule(database.db, user, s.id, { timezone: 'Mars/Base' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await api.scheduler.listSchedules(database.db, user)).toHaveLength(1);
  });

  it('uses the organization time zone by default and previews five fires', async () => {
    api = build('Europe/Warsaw');
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '0 9 * * *',
      template,
    });
    expect(s.nextFireAt.toISOString()).toBe('2026-01-06T08:00:00.000Z');
    const fires = await api.scheduler.preview(database.db, user, '0 9 * * *');
    expect(fires).toHaveLength(5);
    expect(fires[0]?.toISOString()).toBe('2026-01-06T08:00:00.000Z');
    const utc = await api.scheduler.preview(database.db, user, '0 9 * * *', 'UTC');
    expect(utc[0]?.toISOString()).toBe('2026-01-06T09:00:00.000Z');
    await expect(api.scheduler.preview(database.db, user, 'bad')).rejects.toMatchObject({ status: 400 });
  });

  it('run-now creates a task at once and leaves nextFireAt alone', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '0 2 * * *',
      template,
    });
    const { schedule, taskId } = await api.scheduler.runNow(database.db, user, s.id);
    expect(schedule.nextFireAt.toISOString()).toBe(s.nextFireAt.toISOString());
    expect(schedule.lastTaskId).toBe(taskId);
    const [task] = await allTasks();
    expect(task).toMatchObject({ id: taskId, scheduleId: s.id, status: 'queued', priority: 1 });
    expect(actions()).toContain('schedule.run_now');
  });

  it('keeps tasks when a schedule is disabled or deleted', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '* * * * *',
      template,
    });
    await tick('2026-01-05T10:01:00Z');
    await api.scheduler.updateSchedule(database.db, user, s.id, { enabled: false });
    await tick('2026-01-05T10:05:00Z');
    expect(await allTasks()).toHaveLength(1);
    await api.scheduler.deleteSchedule(database.db, user, s.id);
    expect((await allTasks())[0]?.status).toBe('queued');
  });

  it('re-enabling recomputes nextFireAt from now', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '0 2 * * *',
      template,
      enabled: false,
    });
    now = at('2026-03-01T00:00:00Z');
    const again = await api.scheduler.updateSchedule(database.db, user, s.id, { enabled: true });
    expect(again.nextFireAt.toISOString()).toBe('2026-03-01T02:00:00.000Z');
  });
});

describe('scheduler tick', () => {
  it('fires a due schedule once with scheduler audit and advances nextFireAt', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '0 11 * * *',
      template,
    });
    expect((await tick('2026-01-05T10:59:00Z')).fired).toBe(0);
    const result = await tick('2026-01-05T11:00:30Z');
    expect(result).toMatchObject({ leader: true, fired: 1 });
    const [task] = await allTasks();
    expect(task).toMatchObject({ scheduleId: s.id, status: 'queued', title: 'Nightly' });
    const [after] = await database.db.select().from(schedules).where(eq(schedules.id, s.id));
    expect(after?.lastFiredAt?.toISOString()).toBe('2026-01-05T11:00:30.000Z');
    expect(after?.lastTaskId).toBe(task?.id);
    expect(after?.nextFireAt.toISOString()).toBe('2026-01-06T11:00:00.000Z');
    expect((await tick('2026-01-05T11:01:00Z')).fired).toBe(0);
    expect(actions()).toContain('schedule.fire');
    const fire = deps.audit.entries.find((e) => e.action === 'schedule.fire');
    expect(fire?.actorId).toBe(system.principalId);
  });

  it('collapses fires missed while the app was down into one', async () => {
    await api.scheduler.createSchedule(database.db, user, { name: 'n', cron: '*/5 * * * *', template });
    const result = await tick('2026-01-05T13:02:00Z');
    expect(result.fired).toBe(1);
    expect(await allTasks()).toHaveLength(1);
    const [s] = await database.db.select().from(schedules);
    expect(s?.nextFireAt.toISOString()).toBe('2026-01-05T13:05:00.000Z');
  });

  it('skip overlap does not create a task while the previous one is open', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '*/5 * * * *',
      template,
    });
    await tick('2026-01-05T10:05:00Z');
    const skipped = await tick('2026-01-05T10:10:00Z');
    expect(skipped).toMatchObject({ fired: 0, skipped: 1 });
    expect(await allTasks()).toHaveLength(1);
    expect(actions()).toContain('schedule.skip');
    await database.db.update(tasks).set({ status: 'done' }).where(eq(tasks.scheduleId, s.id));
    expect((await tick('2026-01-05T10:15:00Z')).fired).toBe(1);
    expect(await allTasks()).toHaveLength(2);
  });

  it('skip overlap also counts scheduled and rate limited tasks as open', async () => {
    const s = await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '*/5 * * * *',
      template,
    });
    await tick('2026-01-05T10:05:00Z');
    await database.db.update(tasks).set({ status: 'rate_limited' }).where(eq(tasks.scheduleId, s.id));
    expect((await tick('2026-01-05T10:10:00Z')).skipped).toBe(1);
  });

  it('queue overlap creates a task even when the previous one is open', async () => {
    await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '*/5 * * * *',
      template,
      overlap: 'queue',
    });
    await tick('2026-01-05T10:05:00Z');
    await tick('2026-01-05T10:10:00Z');
    expect(await allTasks()).toHaveLength(2);
  });

  it('skips disabled schedules', async () => {
    await api.scheduler.createSchedule(database.db, user, {
      name: 'n',
      cron: '* * * * *',
      template,
      enabled: false,
    });
    expect((await tick('2026-01-05T12:00:00Z')).fired).toBe(0);
  });

  it('two parallel ticks fire a due schedule exactly once', async () => {
    await api.scheduler.createSchedule(database.db, user, { name: 'n', cron: '0 11 * * *', template });
    const results = await Promise.all([tick('2026-01-05T11:00:05Z'), tick('2026-01-05T11:00:05Z')]);
    expect(results.reduce((n, r) => n + r.fired, 0)).toBe(1);
    expect(await allTasks()).toHaveLength(1);
  });

  it('a failing schedule does not block the others and moves past the fire', async () => {
    const bad = await api.scheduler.createSchedule(database.db, user, {
      name: 'bad',
      cron: '*/5 * * * *',
      template,
    });
    await api.scheduler.createSchedule(database.db, user, { name: 'good', cron: '*/5 * * * *', template });
    await database.db
      .update(schedules)
      .set({ template: { ...template, workDir: 'relative' } })
      .where(eq(schedules.id, bad.id));
    const result = await tick('2026-01-05T10:05:00Z');
    expect(result).toMatchObject({ fired: 1, failed: 1 });
    const [after] = await database.db.select().from(schedules).where(eq(schedules.id, bad.id));
    expect(after?.nextFireAt.toISOString()).toBe('2026-01-05T10:10:00.000Z');
    expect(actions()).toContain('schedule.fire_failed');
  });

  it('only a system actor can tick', async () => {
    await expect(api.scheduler.tick(database.db, user, now)).rejects.toMatchObject({ status: 403 });
  });

  describe('Europe/Warsaw DST', () => {
    it('fires once on the spring forward day', async () => {
      api = build('Europe/Warsaw');
      now = at('2026-03-28T12:00:00Z');
      await api.scheduler.createSchedule(database.db, user, { name: 'n', cron: '30 2 * * *', template });
      expect((await tick('2026-03-29T01:29:00Z')).fired).toBe(0);
      expect((await tick('2026-03-29T01:31:00Z')).fired).toBe(1);
      expect((await tick('2026-03-29T05:00:00Z')).fired).toBe(0);
      const [s] = await database.db.select().from(schedules);
      expect(s?.nextFireAt.toISOString()).toBe('2026-03-30T00:30:00.000Z');
    });

    it('fires once on the fall back day', async () => {
      api = build('Europe/Warsaw');
      now = at('2026-10-24T12:00:00Z');
      await api.scheduler.createSchedule(database.db, user, { name: 'n', cron: '30 2 * * *', template });
      expect((await tick('2026-10-25T00:31:00Z')).fired).toBe(1);
      expect((await tick('2026-10-25T01:31:00Z')).fired).toBe(0);
      const [s] = await database.db.select().from(schedules);
      expect(s?.nextFireAt.toISOString()).toBe('2026-10-26T01:30:00.000Z');
    });
  });
});

describe('tick with tasks', () => {
  it('releases due scheduled tasks as system:scheduler', async () => {
    const task = await api.taskApi.createTask(database.db, user, {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      target: { label: 'x' },
      runAt: at('2026-01-05T11:00:00Z'),
    });
    expect(task.status).toBe('scheduled');
    expect((await tick('2026-01-05T10:59:00Z')).released).toBe(0);
    expect((await tick('2026-01-05T11:00:00Z')).released).toBe(1);
    const [after] = await allTasks();
    expect(after).toMatchObject({ status: 'queued', runAt: null });
    const entry = deps.audit.entries.find((e) => e.action === 'task.release_scheduled');
    expect(entry).toMatchObject({ actorId: system.principalId, targetId: task.id });
  });

  it('requeues a rate limited task at resumeAt and counts attempts', async () => {
    const t = await api.taskApi.createTask(database.db, user, {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      target: { label: 'x' },
    });
    await database.db
      .update(tasks)
      .set({ status: 'rate_limited', resumeAt: at('2026-01-05T12:00:00Z'), workerId: 'w' })
      .where(eq(tasks.id, t.id));
    expect((await tick('2026-01-05T11:59:00Z')).resumed).toBe(0);
    expect((await tick('2026-01-05T12:00:01Z')).resumed).toBe(1);
    const [after] = await allTasks();
    expect(after).toMatchObject({ status: 'queued', attempt: 2, resumeAt: null, workerId: null });
    expect(after?.target).toEqual({ label: 'x' });
    expect(actions()).toContain('task.resume');
  });

  it('fails the task once the attempts are exhausted', async () => {
    const t = await api.taskApi.createTask(database.db, user, {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      target: { label: 'x' },
      maxAttempts: 2,
    });
    await database.db
      .update(tasks)
      .set({ status: 'rate_limited', attempt: 2, resumeAt: at('2026-01-05T12:00:00Z') })
      .where(eq(tasks.id, t.id));
    expect(await tick('2026-01-05T12:01:00Z')).toMatchObject({ resumed: 0, exhausted: 1 });
    const [after] = await allTasks();
    expect(after).toMatchObject({
      status: 'failed',
      error: 'rate limit retries exhausted',
      resumeAt: null,
    });
    expect(actions()).toContain('task.resume_exhausted');
  });

  it('leaves rate limited tasks without resumeAt alone', async () => {
    const t = await api.taskApi.createTask(database.db, user, {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      target: { label: 'x' },
    });
    await database.db.update(tasks).set({ status: 'rate_limited' }).where(eq(tasks.id, t.id));
    expect(await tick('2030-01-01T00:00:00Z')).toMatchObject({ resumed: 0, exhausted: 0 });
  });
});
