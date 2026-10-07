import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BoardDto, RunList, TaskDto, TaskList } from '@agent-band/contracts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  await api.close();
});
const get = (path: string) => api.app.inject({ method: 'GET', url: `/api/v1${path}` });
async function task(title = 'Search target') {
  return api.c.tasks.createTask(api.database.db, api.c.localUser, {
    title,
    prompt: 'p',
    workDir: '/w',
    target: { label: 'test' },
  });
}
async function run(taskId: string, accountId = randomUUID()) {
  return api.database.db.transaction((tx) =>
    api.c.runs.startRun(
      tx,
      { ...api.c.localUser, kind: 'system' },
      {
        taskId,
        accountId,
        agentId: randomUUID(),
        workerId: 'test',
        effectivePolicy: {},
        skills: [],
      },
    ),
  );
}

it('returns the latest run with usage on task reads and board, retaining eligibilityReason', async () => {
  const t = await task();
  expect(TaskDto.parse((await get(`/tasks/${t.id}`)).json()).latestRun).toBeNull();
  await run(t.id);
  const latest = await run(t.id);
  await api.database.db.transaction((tx) =>
    api.c.runs.appendRunEvent(tx, { ...api.c.localUser, kind: 'system' }, latest.id, {
      kind: 'usage',
      inputTokens: 12,
      outputTokens: 7,
      cachedTokens: 0,
    }),
  );
  const dto = TaskDto.parse((await get(`/tasks/${t.id}`)).json());
  expect(dto.latestRun).toMatchObject({
    id: latest.id,
    agentId: latest.agentId,
    status: 'running',
    inputTokens: 12,
    outputTokens: 7,
    finishedAt: null,
  });
  expect(dto.eligibilityReason).toBeNull();
  expect(BoardDto.parse((await get('/board')).json()).columns.queued[0]?.latestRun).toEqual(dto.latestRun);
});

it('filters tasks and board by account and literal key/title text, pages terminal columns', async () => {
  const accountId = randomUUID();
  const tasks = await Promise.all([task('Needle 100%'), task('Needle two'), task('Needle three')]);
  for (const t of tasks) {
    await run(t.id, accountId);
    await api.c.tasks.cancelTask(api.database.db, api.c.localUser, t.id);
  }
  await task('Other');
  const query = `accountId=${accountId}&text=needle&limit=2`;
  const board = BoardDto.parse((await get(`/board?${query}`)).json());
  expect(board.columns.cancelled).toHaveLength(2);
  expect(board.columns.queued).toHaveLength(0);
  expect(board.nextCursors.cancelled).toBeTruthy();
  const cancelledCursor = board.nextCursors.cancelled;
  if (!cancelledCursor) throw new Error('missing cursor');
  const next = TaskList.parse(
    (await get(`/tasks?${query}&status=cancelled&pageCursor=${encodeURIComponent(cancelledCursor)}`)).json(),
  );
  expect(next.items).toHaveLength(1);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...board.columns.cancelled, ...next.items].map((t) => t.id)).size).toBe(3);
  expect(TaskList.parse((await get('/tasks?text=100%25')).json()).items).toHaveLength(1);
  expect(TaskList.parse((await get(`/tasks?accountId=${randomUUID()}`)).json()).items).toHaveLength(0);
  expect(TaskList.parse((await get(`/tasks?text=${tasks.map((t) => t.key)[0]}`)).json()).items).toHaveLength(
    1,
  );
  expect((await get('/tasks?status=cancelled&pageCursor=bad')).statusCode).toBe(400);
});

it('pages runs with task search, inclusive time bounds and org isolation', async () => {
  const t = await task();
  const accountId = randomUUID();
  const runs = [];
  // One transaction gives all rows the same timestamp, exercising the id tie breaker.
  await api.database.db.transaction(async (tx) => {
    for (let i = 0; i < 3; i++)
      runs.push(
        await api.c.runs.startRun(
          tx,
          { ...api.c.localUser, kind: 'system' },
          {
            taskId: t.id,
            accountId,
            agentId: randomUUID(),
            workerId: 'test',
            effectivePolicy: {},
            skills: [],
          },
        ),
      );
  });
  await run((await task('Unrelated')).id);
  const first = RunList.parse(
    (await get('/runs?text=search&limit=2&from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')).json(),
  );
  expect(first.items).toHaveLength(2);
  if (!first.nextCursor) throw new Error('missing cursor');
  const second = RunList.parse(
    (await get(`/runs?text=search&limit=2&pageCursor=${encodeURIComponent(first.nextCursor)}`)).json(),
  );
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(3);
  expect(RunList.parse((await get('/runs?from=2100-01-01T00:00:00Z')).json()).items).toHaveLength(0);
  expect((await get('/runs?from=2100-01-01T00:00:00Z&to=2000-01-01T00:00:00Z')).statusCode).toBe(400);
  expect((await get('/runs?limit=0')).statusCode).toBe(400);
  expect((await get('/runs?pageCursor={}')).statusCode).toBe(400);
  api.as({ ...api.c.localUser, orgId: randomUUID(), kind: 'system' });
  expect(RunList.parse((await get('/runs')).json()).items).toHaveLength(0);
});

it('does not audit board, task and run reads', async () => {
  const t = await task();
  await run(t.id);
  const count = async () =>
    (await api.c.audit.listAudit(api.database.db, api.c.localUser, { limit: 200 })).items.length;
  const before = await count();
  for (const path of ['/board', '/tasks?text=search', '/runs?text=search&limit=1'])
    expect((await get(path)).statusCode).toBe(200);
  expect(await count()).toBe(before);
});
