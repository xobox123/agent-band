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
  /** Reported spend (USD) per day; mainly for API-key accounts. */
  dailyCostBudgetUsd?: number;
  /** Keeps a reserve: no new runs while a fresh window is at or above its threshold. */
  stopAt?: { fiveHourPercent?: number; weeklyPercent?: number };
}
/** Snapshots older than this are not trusted for the reserve decision. */
export const FRESH_SNAPSHOT_MS = 15 * 60_000;
export type Availability =
  | { ok: true }
  | {
      ok: false;
      reason: 'rate_limited' | 'concurrency' | 'daily_budget' | 'daily_cost_budget' | 'reserve';
      resetsAt?: Date;
      detail?: string;
    };
/** First window at or above its threshold, judged only on fresh snapshots of windows that have not reset. */
export function reserveReached(
  windows: (LimitWindow & { observedAt: Date })[],
  stopAt: AccountLimits['stopAt'],
  now: Date,
): { detail: string; resetsAt?: Date } | null {
  if (!stopAt) return null;
  for (const w of windows) {
    const threshold = w.window === '5h' ? stopAt.fiveHourPercent : stopAt.weeklyPercent;
    if (threshold === undefined) continue;
    if (now.getTime() - w.observedAt.getTime() > FRESH_SNAPSHOT_MS) continue;
    if (w.resetsAt && new Date(w.resetsAt) <= now) continue;
    if (w.usedPercent >= threshold) {
      return {
        detail: `reserve threshold reached (${w.window} ${Math.round(w.usedPercent)}% >= ${threshold}%)`,
        ...(w.resetsAt && { resetsAt: new Date(w.resetsAt) }),
      };
    }
  }
  return null;
}
export function blockingReset(windows: LimitWindow[], explicit: Date | null, now: Date): Date | null {
  const dates = windows
    .filter((w) => w.usedPercent >= 100 && w.resetsAt)
    .map((w) => new Date(w.resetsAt ?? ''));
  if (explicit) dates.push(explicit);
  return dates.filter((d) => d > now).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}
