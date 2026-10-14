import { describe, expect, it } from 'vitest';
import { MAX_WORKER_SLOTS, resolveWorkerSlots } from './worker-capacity.ts';

describe('worker capacity', () => {
  it('uses account concurrency as the automatic default', () => {
    expect(resolveWorkerSlots([2, 3, 1], null)).toBe(6);
    expect(resolveWorkerSlots([], null)).toBe(1);
    expect(resolveWorkerSlots([200, 200], null)).toBe(MAX_WORKER_SLOTS);
  });

  it('prioritizes persisted settings over environment, then falls back to auto', () => {
    expect(resolveWorkerSlots([2], 3, 7)).toBe(3);
    expect(resolveWorkerSlots([2], null, 7)).toBe(7);
    expect(resolveWorkerSlots([2], null)).toBe(2);
  });
});
