import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { outboxEvents } from '../../../platform/schema.ts';
import { fakeDeps, testActor } from '../../../ports/testing.ts';
import { createRuns } from '../index.ts';
import { runEvents } from '../infra/schema.ts';
let database: Database;
let deps: ReturnType<typeof fakeDeps>;
let api: ReturnType<typeof createRuns>;
const actor = testActor();
const system = { ...actor, kind: 'system' as const };
const input = () => ({
  taskId: randomUUID(),
  agentId: randomUUID(),
  accountId: randomUUID(),
  workerId: 'worker',
  effectivePolicy: { sources: [] },
  skills: [],
});
beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  api = createRuns(deps);
});
afterEach(async () => {
  await database.close();
});
const start = () => database.db.transaction((tx) => api.startRun(tx, system, input()));
it('accumulates normalized usage, preserves unknown costs, publishes run event ids, and audits start/finish', async () => {
  const run = await start();
  await database.db.transaction(async (tx) => {
    await api.appendRunEvent(tx, system, run.id, { kind: 'text', text: 'Hello' });
    await api.appendRunEvent(tx, system, run.id, {
      kind: 'usage',
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 3,
    });
    await api.appendRunEvent(tx, system, run.id, {
      kind: 'usage',
      inputTokens: 7,
      outputTokens: 4,
      cachedTokens: 2,
      costUsd: 0.2,
    });
    await api.appendRunEvent(tx, system, run.id, {
      kind: 'usage',
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 0,
      costUsd: 0.1,
    });
  });
  const finished = await database.db.transaction((tx) =>
    api.finishRun(tx, system, run.id, { status: 'done', exitCode: 0 }),
  );
  expect(finished).toMatchObject({
    inputTokens: 18,
    outputTokens: 11,
    cachedTokens: 5,
    costUsd: 0.30000000000000004,
    status: 'done',
  });
  expect(finished.finishedAt).toBeInstanceOf(Date);
  expect(deps.audit.entries.map((e) => e.action)).toEqual(
    expect.arrayContaining(['run.start', 'run.finish']),
  );
  const events = await api.listRunEvents(database.db, actor, run.id);
  expect(events.length).toBe(4);
  expect((await api.listRunEvents(database.db, actor, run.id, events[1]?.id)).map((e) => e.kind)).toEqual([
    'usage',
    'usage',
  ]);
  const outbox = await database.db.select().from(outboxEvents);
  expect(
    outbox.filter((e) => e.type === 'run.event').map((e) => (e.payload as { eventId: number }).eventId),
  ).toEqual(events.map((e) => e.id));
  expect(outbox.filter((e) => e.type === 'run.event')[0]?.id).not.toBe(events[0]?.id);
});
it('rejects non-system workers, invalid usage, events after finish and duplicate finishes', async () => {
  await expect(database.db.transaction((tx) => api.startRun(tx, actor, input()))).rejects.toMatchObject({
    status: 403,
  });
  const run = await start();
  await expect(
    database.db.transaction((tx) =>
      api.appendRunEvent(tx, system, run.id, {
        kind: 'usage',
        inputTokens: -1,
        outputTokens: 0,
        cachedTokens: 0,
      }),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await database.db.transaction((tx) => api.finishRun(tx, system, run.id, { status: 'cancelled' }));
  await expect(
    database.db.transaction((tx) => api.appendRunEvent(tx, system, run.id, { kind: 'text', text: 'late' })),
  ).rejects.toMatchObject({ code: 'run_terminal' });
  await expect(
    database.db.transaction((tx) => api.finishRun(tx, system, run.id, { status: 'done' })),
  ).rejects.toMatchObject({ code: 'run_terminal' });
});
it('isolates orgs, scopes read authorization, and rolls back failed audit', async () => {
  const run = await start();
  expect(await api.listRuns(database.db, testActor())).toEqual([]);
  await expect(api.listRunEvents(database.db, testActor(), run.id)).rejects.toMatchObject({ status: 404 });
  await api.listRunEvents(database.db, actor, run.id);
  expect(deps.authorizer.checks.at(-1)?.resource).toEqual({ agentId: run.agentId });
  const broken = createRuns({ ...deps, audit: { append: () => Promise.reject(new Error('audit failed')) } });
  await expect(
    database.db.transaction((tx) =>
      broken.appendRunEvent(tx, system, run.id, {
        kind: 'usage',
        inputTokens: 10,
        outputTokens: 0,
        cachedTokens: 0,
      }),
    ),
  ).rejects.toThrow('audit failed');
  expect((await api.listRuns(database.db, actor))[0]?.inputTokens).toBe(0);
  expect(await api.listRunEvents(database.db, actor, run.id)).toEqual([]);
});
it('recovers only running runs for the specified worker and org', async () => {
  const a = await start();
  await database.db.transaction((tx) => api.startRun(tx, system, { ...input(), workerId: 'other' }));
  await database.db.transaction((tx) => api.startRun(tx, testActor({ kind: 'system' }), input()));
  const recovered = await api.recoverStaleRuns(database.db, system, 'worker');
  expect(recovered.map((r) => r.id)).toEqual([a.id]);
  expect(recovered[0]?.status).toBe('failed');
  expect(await api.recoverStaleRuns(database.db, system, 'worker')).toEqual([]);
});
it('sums usage by local event day across midnight and DST, excluding other orgs and scopes', async () => {
  const run = await start();
  const event = await database.db.transaction((tx) =>
    api.appendRunEvent(tx, system, run.id, {
      kind: 'usage',
      inputTokens: 10,
      outputTokens: 2,
      cachedTokens: 3,
    }),
  );
  await database.db
    .update(runEvents)
    .set({ ts: new Date('2026-03-29T22:30:00Z') })
    .where(eq(runEvents.id, event.id));
  const now = new Date('2026-03-30T00:30:00Z');
  expect(await api.usageOnDay(database.db, actor, { agentId: run.agentId }, 'Europe/Warsaw', now)).toBe(15);
  expect(await api.usageOnDay(database.db, actor, { accountId: run.accountId }, 'UTC', now)).toBe(0);
  expect(await api.usageOnDay(database.db, actor, { agentId: randomUUID() }, 'Europe/Warsaw', now)).toBe(0);
  expect(await api.usageOnDay(database.db, testActor(), {}, 'Europe/Warsaw', now)).toBe(0);
  expect(await api.runningCount(database.db, actor, run.accountId)).toBe(1);
});
it('finishes a rate-limited run as rate_limited even when the process exits successfully', async () => {
  const run = await start();
  await database.db.transaction((tx) =>
    api.appendRunEvent(tx, system, run.id, {
      kind: 'rate_limit',
      limitReached: true,
      windows: [],
      resetsAt: '2026-10-07T00:00:00Z',
    }),
  );
  const finished = await database.db.transaction((tx) =>
    api.finishRun(tx, system, run.id, { status: 'done', exitCode: 0 }),
  );
  expect(finished.status).toBe('rate_limited');
  expect(finished.rateLimitResetsAt?.toISOString()).toBe('2026-10-07T00:00:00.000Z');
});
it('attributes tool use to the agent that ran it', async () => {
  const run = await start();
  await database.db.transaction((tx) =>
    api.appendRunEvent(tx, system, run.id, { kind: 'tool', name: 'Read', input: { path: 'a' } }),
  );
  const entry = deps.audit.entries.find((e) => e.action === 'agent.tool_use');
  expect(entry).toMatchObject({ actorId: run.agentId, targetId: run.id });
  expect(deps.audit.entries.find((e) => e.action === 'run.start')?.actorId).toBe(system.principalId);
});
