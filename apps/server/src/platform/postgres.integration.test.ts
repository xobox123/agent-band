import { describe, expect, it } from 'vitest';
import { openDatabase } from './db.ts';
import { EventStream, publish, type OutboxEvent } from './outbox.ts';
import { withTx } from './tx.ts';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('real Postgres', () => {
  it('migrates, publishes and delivers through LISTEN/NOTIFY', async () => {
    const database = await openDatabase({ databaseUrl: url });
    const stream = new EventStream(database);
    const received: OutboxEvent[] = [];
    stream.subscribe((e) => received.push(e));
    await stream.start();
    try {
      await withTx(database.db, (tx) => publish(tx, 'it.event', { ok: true }));
      for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
      expect(received[0]).toMatchObject({ type: 'it.event', payload: { ok: true } });
    } finally {
      await stream.stop();
      await database.close();
    }
  });
});
