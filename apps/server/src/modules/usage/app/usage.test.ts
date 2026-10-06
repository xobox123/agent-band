import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createUsage } from '../index.ts';
let database: Database;
let deps: ReturnType<typeof fakeDeps>;
let api: ReturnType<typeof createUsage>;
const actor = testActor();
const system = { ...actor, kind: 'system' as const };
const accountId = randomUUID();
const now = new Date('2026-10-06T23:30:00Z');
const future = '2026-10-07T02:00:00Z';
const usageOnDay = vi.fn(() => Promise.resolve(30));
const runningCount = vi.fn(() => Promise.resolve(0));
beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  usageOnDay.mockClear().mockResolvedValue(30);
  runningCount.mockClear().mockResolvedValue(0);
  api = createUsage({
    ...deps,
    orgSettings: new FakeOrgSettings({ taskKeyPrefix: 'AB', timezone: 'Europe/Warsaw' }),
    usageOnDay,
    runningCount,
  });
});
afterEach(async () => {
  await database.close();
});
it('uses newest snapshot per window and the latest future exhausted reset', async () => {
  await database.db.transaction(async (tx) => {
    await api.recordWindows(tx, system, accountId, [
      { window: '5h', usedPercent: 100, resetsAt: future },
      { window: 'weekly', usedPercent: 110, resetsAt: '2026-10-08T00:00:00Z' },
    ]);
  });
  expect((await api.accountBlock(database.db, actor, accountId, now))?.toISOString()).toBe(
    '2026-10-08T00:00:00.000Z',
  );
  await database.db.transaction((tx) =>
    api.recordWindows(tx, system, accountId, [{ window: 'weekly', usedPercent: 20, resetsAt: null }]),
  );
  expect((await api.latestWindows(database.db, actor, accountId)).length).toBe(2);
  expect((await api.accountBlock(database.db, actor, accountId, now))?.toISOString()).toBe(
    '2026-10-07T02:00:00.000Z',
  );
  expect(await api.accountBlock(database.db, actor, accountId, new Date('2026-10-09'))).toBeNull();
});
it('explicit blocks never shorten and stay isolated by account and org', async () => {
  await database.db.transaction(async (tx) => {
    await api.blockAccount(tx, system, accountId, new Date(future));
    await api.blockAccount(tx, system, accountId, now);
  });
  expect((await api.accountBlock(database.db, actor, accountId, now))?.toISOString()).toBe(
    new Date(future).toISOString(),
  );
  expect(await api.accountBlock(database.db, testActor(), accountId, now)).toBeNull();
  expect(await api.accountBlock(database.db, actor, randomUUID(), now)).toBeNull();
});
it('tokensToday uses OrgSettings timezone and preserves actor and scope', async () => {
  const scope = { agentId: randomUUID() };
  expect(await api.tokensToday(database.db, actor, scope, now)).toBe(30);
  expect(usageOnDay).toHaveBeenCalledWith(expect.anything(), actor, scope, 'Europe/Warsaw', now);
  expect(deps.authorizer.checks[0]?.resource).toEqual(scope);
});
it('checks block, concurrency and budget and returns an explicit reason without failover', async () => {
  expect(await api.accountAvailability(database.db, actor, accountId, { maxConcurrentRuns: 1 }, now)).toEqual(
    { ok: true },
  );
  runningCount.mockResolvedValue(1);
  expect(await api.accountAvailability(database.db, actor, accountId, { maxConcurrentRuns: 1 }, now)).toEqual(
    { ok: false, reason: 'concurrency' },
  );
  runningCount.mockResolvedValue(0);
  expect(
    await api.accountAvailability(
      database.db,
      actor,
      accountId,
      { maxConcurrentRuns: 1, dailyTokenBudget: 30 },
      now,
    ),
  ).toEqual({ ok: false, reason: 'daily_budget' });
  await database.db.transaction((tx) => api.blockAccount(tx, system, accountId, new Date(future)));
  expect(await api.accountAvailability(database.db, actor, accountId, { maxConcurrentRuns: 1 }, now)).toEqual(
    { ok: false, reason: 'rate_limited', resetsAt: new Date(future) },
  );
});
it('requires system writers, authorizes reads, and rolls back snapshots', async () => {
  await expect(
    database.db.transaction((tx) => api.recordWindows(tx, actor, accountId, [])),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    database.db.transaction(async (tx) => {
      await api.recordWindows(tx, system, accountId, [{ window: '5h', usedPercent: 100, resetsAt: future }]);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await api.latestWindows(database.db, actor, accountId)).toEqual([]);
  deps.authorizer.deny = () => true;
  await expect(api.tokensToday(database.db, actor, {})).rejects.toMatchObject({ status: 403 });
});
