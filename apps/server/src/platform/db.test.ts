import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { openTestDatabase, type Database } from './db.ts';
import { withTx } from './tx.ts';

const rows = (res: unknown): Record<string, unknown>[] => (res as { rows: Record<string, unknown>[] }).rows;

let database: Database | undefined;
afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('openTestDatabase', () => {
  it('applies migrations and creates outbox_events', async () => {
    database = await openTestDatabase();
    const res = await database.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'outbox_events' order by ordinal_position`,
    );
    expect(rows(res).map((r) => r['column_name'])).toEqual(['id', 'ts', 'type', 'payload']);
  });

  it('withTx commits and rolls back', async () => {
    database = await openTestDatabase();
    const { db } = database;
    await db.execute(sql`create table t (n int)`);
    await withTx(db, (tx) => tx.execute(sql`insert into t values (1)`));
    await expect(
      withTx(db, async (tx) => {
        await tx.execute(sql`insert into t values (2)`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const res = await db.execute(sql`select n from t`);
    expect(rows(res)).toEqual([{ n: 1 }]);
  });
});
