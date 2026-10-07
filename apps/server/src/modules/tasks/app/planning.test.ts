import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createTasks } from '../index.ts';

let database: Database;
const actor = testActor();
const system = { ...actor, kind: 'system' as const };
let deps: ReturnType<typeof fakeDeps>;
let settings: FakeOrgSettings;
let api: ReturnType<typeof createTasks>;
let now = new Date('2026-10-07T10:00:00Z');
const input = { title: 'T', prompt: 'P', workDir: '/work', target: { label: 'be' } };
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  settings = new FakeOrgSettings({
    workspaceRoot: join(process.env['TMPDIR'] ?? '/tmp', `ab-ws-${Date.now()}`),
  });
  now = new Date('2026-10-07T10:00:00Z');
  api = createTasks({ ...deps, orgSettings: settings, now: () => now });
});
afterEach(async () => {
  await database.close();
});
const draft = (over = {}) => api.createTask(database.db, actor, { ...input, draft: true, ...over });
const actions = () => deps.audit.entries.map((e) => e.action);

describe('workspace folders', () => {
  it('assigns <workspaceRoot>/<key> when workDir is omitted and creates it privately', async () => {
    const t = await api.createTask(database.db, actor, { title: 'T', prompt: 'P', target: { label: 'x' } });
    expect(t.workDir).toBe(join(settings.settings.workspaceRoot, t.key));
    expect(statSync(t.workDir).mode & 0o777).toBe(0o700);
  });
  it('keeps an explicit workDir and does not create it', async () => {
    const t = await api.createTask(database.db, actor, { ...input, workDir: '/nonexistent/ab-x' });
    expect(t.workDir).toBe('/nonexistent/ab-x');
    expect(existsSync('/nonexistent/ab-x')).toBe(false);
  });
  it('uses a sanitized slug when given', async () => {
    const t = await api.createTask(database.db, actor, {
      title: 'T',
      prompt: 'P',
      target: { label: 'x' },
      workDirSlug: 'nightly build',
    });
    expect(t.workDir).toBe(join(settings.settings.workspaceRoot, 'nightly-build'));
  });
});

describe('drafts', () => {
  it('are created as draft, never claimed, and keep runAt', async () => {
    const t = await draft({ runAt: hours(2) });
    expect(t).toMatchObject({ status: 'draft', proposed: false });
    expect(await database.db.transaction((tx) => api.claimNextTask(tx, system, 'w'))).toBeNull();
  });

  it('are editable, queued tasks are not', async () => {
    const t = await draft();
    const edited = await api.updateDraft(database.db, actor, t.id, {
      title: 'New',
      priority: 0,
      mode: 'read-only',
      target: { label: 'fe' },
      maxAttempts: 5,
    });
    expect(edited).toMatchObject({ title: 'New', priority: 0, mode: 'read-only', maxAttempts: 5 });
    expect(actions()).toContain('task.update');
    const [queued] = await api.startTasks(database.db, actor, [t.id]);
    await expect(api.updateDraft(database.db, actor, t.id, { title: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'task_not_draft',
    });
    expect(queued?.status).toBe('queued');
  });

  it('validates dependencies: unknown, self and cycles', async () => {
    const a = await draft();
    const b = await draft({ dependsOn: [a.id] });
    await expect(api.updateDraft(database.db, actor, a.id, { dependsOn: [b.id] })).rejects.toMatchObject({
      status: 400,
    });
    await expect(api.updateDraft(database.db, actor, a.id, { dependsOn: [a.id] })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      api.updateDraft(database.db, actor, a.id, { dependsOn: [crypto.randomUUID()] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('delete removes the draft and the dependency on it', async () => {
    const a = await draft();
    const b = await draft({ dependsOn: [a.id] });
    await api.deleteDraft(database.db, actor, a.id);
    expect((await api.getTask(database.db, actor, b.id)).dependsOn).toEqual([]);
    await expect(api.getTask(database.db, actor, a.id)).rejects.toMatchObject({ status: 404 });
    expect(actions()).toContain('task.delete');
    const q = await api.createTask(database.db, actor, input);
    await expect(api.deleteDraft(database.db, actor, q.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('start', () => {
  it('start now queues a draft and keeps its dependencies', async () => {
    const a = await draft();
    const b = await draft({ dependsOn: [a.id] });
    const [sb] = await api.startTasks(database.db, actor, [b.id]);
    expect(sb).toMatchObject({ status: 'queued', dependsOn: [a.id] });
    expect(actions()).toContain('task.start');
    expect(await database.db.transaction((tx) => api.claimNextTask(tx, system, 'w'))).toBeNull();
  });

  it('a draft with a future runAt becomes scheduled', async () => {
    const t = await draft({ runAt: hours(3) });
    const [s] = await api.startTasks(database.db, actor, [t.id]);
    expect(s).toMatchObject({ status: 'scheduled', startAfterReset: false });
    expect(s?.runAt?.toISOString()).toBe(hours(3).toISOString());
  });

  it('start at overrides runAt and limit reset marks the task', async () => {
    const a = await draft();
    const b = await draft();
    const [sa] = await api.startTasks(database.db, actor, [a.id], () => ({ runAt: hours(1) }));
    expect(sa).toMatchObject({ status: 'scheduled', startAfterReset: false });
    const [sb] = await api.startTasks(database.db, actor, [b.id], () => ({
      runAt: hours(5),
      afterReset: true,
    }));
    expect(sb).toMatchObject({ status: 'scheduled', startAfterReset: true });
  });

  it('no plan behaves like start now', async () => {
    const t = await draft();
    const [s] = await api.startTasks(database.db, actor, [t.id], () => undefined);
    expect(s).toMatchObject({ status: 'queued', runAt: null, startAfterReset: false });
  });

  it('bulk start is atomic: one non-draft task leaves every draft untouched', async () => {
    const a = await draft();
    const b = await draft();
    const q = await api.createTask(database.db, actor, input);
    await expect(api.startTasks(database.db, actor, [a.id, b.id, q.id])).rejects.toMatchObject({
      status: 409,
    });
    expect((await api.getTask(database.db, actor, a.id)).status).toBe('draft');
    expect((await api.getTask(database.db, actor, b.id)).status).toBe('draft');
    await expect(api.startTasks(database.db, actor, [a.id, crypto.randomUUID()])).rejects.toMatchObject({
      status: 404,
    });
    const started = await api.startTasks(database.db, actor, [b.id, a.id]);
    expect(started.map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it('refuses proposed subtasks; they start through plan approval', async () => {
    const goal = await api.createTask(database.db, actor, {
      ...input,
      kind: 'goal',
      target: { agentId: crypto.randomUUID() },
    });
    const child = await database.db.transaction((tx) =>
      api.createChildTask(tx, actor, input, {
        kind: 'task',
        rootTaskId: goal.id,
        parentTaskId: goal.id,
        depth: 1,
        dependsOn: [],
        proposed: true,
      }),
    );
    expect(child).toMatchObject({ status: 'draft', proposed: true });
    await expect(api.startTasks(database.db, actor, [child.id])).rejects.toMatchObject({
      code: 'task_proposed',
    });
  });
});

describe('goal approval option', () => {
  it('is stored on the goal state and only allowed for goals', async () => {
    const goal = await api.createTask(database.db, actor, {
      ...input,
      kind: 'goal',
      target: { agentId: crypto.randomUUID() },
      approval: 'required',
    });
    expect((await api.getGoalState(database.db, actor.orgId, goal.id))?.approval).toBe('required');
    await expect(
      api.createTask(database.db, actor, { ...input, approval: 'required' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
