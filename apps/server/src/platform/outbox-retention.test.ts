import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { openTestDatabase, type Database } from './db.ts';
import {
  highestIssuedOutboxId,
  latestOutboxId,
  oldestOutboxId,
  outboxSince,
  publish,
  pruneOutbox,
} from './outbox.ts';

let database: Database;
beforeEach(async () => {
  database = await openTestDatabase();
});
afterEach(async () => {
  await database.close();
});

it('prunes rows older than the retention window and keeps the cursor monotonic', async () => {
  const { db } = database;
  expect(await latestOutboxId(db)).toBe(0);
  await db.transaction((tx) => publish(tx, 'a', { orgId: 'o' }));
  await db.transaction((tx) => publish(tx, 'b', { orgId: 'o' }));
  await db.execute(sql`update outbox_events set ts = now() - interval '25 hours' where type = 'a'`);
  expect(await pruneOutbox(db)).toBe(1);
  expect(await oldestOutboxId(db)).toBe(2);
  expect((await outboxSince(db, 0, 10)).map((e) => e.type)).toEqual(['b']);

  await db.execute(sql`update outbox_events set ts = now() - interval '25 hours'`);
  await pruneOutbox(db);
  expect(await oldestOutboxId(db)).toBeNull();
  expect(await latestOutboxId(db)).toBe(2);
  expect(await highestIssuedOutboxId(db)).toBe(2);
});

it('honours an explicit retention and clock', async () => {
  const { db } = database;
  await db.transaction((tx) => publish(tx, 'a', { orgId: 'o' }));
  expect(await pruneOutbox(db, new Date(Date.now() + 1000), 10)).toBe(1);
});
