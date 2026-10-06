import { expect, it } from 'vitest';
import { startSchedulerLoop } from './loop.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('ticks repeatedly, survives errors and waits for the running tick on stop', async () => {
  let calls = 0;
  let finished = 0;
  const errors: unknown[] = [];
  const loop = startSchedulerLoop(
    async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      await sleep(40);
      finished++;
    },
    { intervalMs: 10, onError: (e) => errors.push(e) },
  );
  while (calls < 3) await sleep(10);
  await loop.stop();
  expect(errors).toHaveLength(1);
  expect(finished).toBe(calls - 1);
  const after = calls;
  await sleep(60);
  expect(calls).toBe(after);
});
