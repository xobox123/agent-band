import { describe, expect, it } from 'vitest';
import { openDatabase } from '../platform/db.ts';
import { runs } from '../modules/runs/infra/schema.ts';
import { makeKit, waitFor } from './worker.testkit.ts';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('real Postgres workers', () => {
  it('two workers never run the same task', async () => {
    const kit = await makeKit(await openDatabase({ databaseUrl: url }));
    const workers: ReturnType<typeof kit.worker>[] = [];
    try {
      const acc = await kit.account('a');
      await kit.agent('alpha', acc.id, { labels: ['x'] });
      kit.script = () => ({ events: [{ kind: 'text', text: 'a' }], delayMs: 5 });
      const tasks = await Promise.all(Array.from({ length: 10 }, () => kit.task({ target: { label: 'x' } })));
      for (const id of ['w1', 'w2']) {
        const w = kit.worker({ workerId: id, slots: 3 });
        workers.push(w);
        await w.start();
      }
      for (const t of tasks)
        await waitFor(async () => (await kit.taskStatus(t.id))?.status === 'done', 20_000);
      const all = await kit.db.select().from(runs);
      const mine = all.filter((r) => tasks.some((t) => t.id === r.taskId));
      expect(new Set(mine.map((r) => r.taskId)).size).toBe(10);
      expect(mine).toHaveLength(10);
    } finally {
      for (const w of workers) await w.stop({ force: true });
      await kit.close();
    }
  }, 40_000);
});
