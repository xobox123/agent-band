/** Capacity is derived from account limits when no explicit project-wide limit is configured. */
export const MAX_WORKER_SLOTS = 256;

export function resolveWorkerSlots(
  accountConcurrency: readonly number[],
  saved: number | null,
  configured?: number,
): number {
  if (saved !== null) return saved;
  if (configured !== undefined) return configured;
  const sum = accountConcurrency.reduce((total, limit) => total + Math.max(0, limit), 0);
  return Math.min(MAX_WORKER_SLOTS, Math.max(1, sum));
}
