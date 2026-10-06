import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type Database } from './db.ts';
import { EventStream, publish, type OutboxEvent } from './outbox.ts';
import { withTx } from './tx.ts';

let database: Database | undefined;
let stream: EventStream | undefined;
afterEach(async () => {
  await stream?.stop();
  await database?.close();
  stream = undefined;
  database = undefined;
});

const tick = (ms = 100): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function setup(): Promise<{ database: Database; received: OutboxEvent[] }> {
  database = await openTestDatabase();
  stream = new EventStream(database);
  const received: OutboxEvent[] = [];
  stream.subscribe((e) => received.push(e));
  await stream.start();
  return { database, received };
}

describe('outbox', () => {
  it('delivers events from a committed transaction', async () => {
    const { database, received } = await setup();
    await withTx(database.db, async (tx) => {
      await publish(tx, 'task.created', { id: 'a' });
      await publish(tx, 'task.moved', { id: 'a' });
    });
    await tick();
    expect(received.map((e) => [e.type, e.payload])).toEqual([
      ['task.created', { id: 'a' }],
      ['task.moved', { id: 'a' }],
    ]);
    expect(received[1]?.id).toBeGreaterThan(received[0]?.id ?? Infinity);
  });

  it('emits nothing for a rolled-back transaction', async () => {
    const { database, received } = await setup();
    await expect(
      withTx(database.db, async (tx) => {
        await publish(tx, 'task.created', { id: 'x' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await tick();
    expect(received).toEqual([]);
  });

  it('stops delivering after unsubscribe', async () => {
    const { database, received } = await setup();
    const extra: OutboxEvent[] = [];
    const off = (stream as EventStream).subscribe((e) => extra.push(e));
    off();
    await withTx(database.db, (tx) => publish(tx, 'a', {}));
    await tick();
    expect(received).toHaveLength(1);
    expect(extra).toEqual([]);
  });
});
