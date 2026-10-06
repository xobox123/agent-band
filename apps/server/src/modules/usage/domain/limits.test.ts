import { expect, it } from 'vitest';
import { blockingReset } from './limits.ts';
it('ignores windows without a future reset and selects the longest block', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  expect(
    blockingReset(
      [
        { window: '5h', usedPercent: 100, resetsAt: null },
        { window: 'weekly', usedPercent: 100, resetsAt: now.toISOString() },
      ],
      null,
      now,
    ),
  ).toBeNull();
  expect(
    blockingReset(
      [{ window: '5h', usedPercent: 99, resetsAt: '2026-10-09T00:00:00Z' }],
      new Date('2026-10-07T00:00:00Z'),
      now,
    ),
  ).toEqual(new Date('2026-10-07T00:00:00Z'));
});
