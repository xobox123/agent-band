export interface UsageScope {
  agentId?: string;
  accountId?: string;
}
export interface LimitWindow {
  window: '5h' | 'weekly';
  usedPercent: number;
  resetsAt: string | null;
}
export interface AccountLimits {
  maxConcurrentRuns: number;
  dailyTokenBudget?: number;
}
export type Availability =
  { ok: true } | { ok: false; reason: 'rate_limited' | 'concurrency' | 'daily_budget'; resetsAt?: Date };
export function blockingReset(windows: LimitWindow[], explicit: Date | null, now: Date): Date | null {
  const dates = windows
    .filter((w) => w.usedPercent >= 100 && w.resetsAt)
    .map((w) => new Date(w.resetsAt ?? ''));
  if (explicit) dates.push(explicit);
  return dates.filter((d) => d > now).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}
