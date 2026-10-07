import { and, desc, eq, sql } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { DbOrTx, ModuleDeps, OrgSettings } from '../../../ports/index.ts';
import { forbidden, invalid } from '../../../platform/errors.ts';
import { accountBlocks, usageSnapshots } from '../infra/schema.ts';
import {
  blockingReset,
  reserveReached,
  type AccountLimits,
  type Availability,
  type LimitWindow,
  type UsageScope,
} from '../domain/limits.ts';
export interface UsageDeps extends ModuleDeps {
  orgSettings: OrgSettings;
  usageOnDay(
    db: DbOrTx,
    actor: ActorContext,
    scope: UsageScope,
    timezone: string,
    now: Date,
    kind?: 'billable' | 'cached',
  ): Promise<number>;
  runningCount(db: DbOrTx, actor: ActorContext, accountId: string): Promise<number>;
  costOnPeriod?(
    db: DbOrTx,
    actor: ActorContext,
    accountId: string,
    timezone: string,
    now: Date,
    period: 'day' | 'month',
  ): Promise<number>;
}
export function createUsage(deps: UsageDeps) {
  function system(actor: ActorContext) {
    if (actor.kind !== 'system') throw forbidden('System actor required');
  }
  async function authorize(
    tx: Tx,
    actor: ActorContext,
    action: 'read' | 'task.write',
    scope: UsageScope = {},
  ) {
    await deps.authorizer.authorize(tx, actor, action, scope.agentId ? { agentId: scope.agentId } : {});
  }
  async function latestRows(tx: Tx, actor: ActorContext, accountId: string) {
    return tx
      .selectDistinctOn([usageSnapshots.window])
      .from(usageSnapshots)
      .where(and(eq(usageSnapshots.orgId, actor.orgId), eq(usageSnapshots.accountId, accountId)))
      .orderBy(usageSnapshots.window, desc(usageSnapshots.id));
  }
  async function latest(tx: Tx, actor: ActorContext, accountId: string): Promise<LimitWindow[]> {
    const rows = await latestRows(tx, actor, accountId);
    return rows.map((r) => ({
      window: r.window,
      usedPercent: r.usedPercent,
      resetsAt: r.resetsAt?.toISOString() ?? null,
    }));
  }
  async function block(tx: Tx, actor: ActorContext, accountId: string, now: Date) {
    const [explicit] = await tx
      .select()
      .from(accountBlocks)
      .where(and(eq(accountBlocks.orgId, actor.orgId), eq(accountBlocks.accountId, accountId)));
    return blockingReset(await latest(tx, actor, accountId), explicit?.until ?? null, now);
  }
  async function tokens(
    tx: Tx,
    actor: ActorContext,
    scope: UsageScope,
    now: Date,
    kind: 'billable' | 'cached' = 'billable',
  ) {
    const { timezone } = await deps.orgSettings.get(tx, actor.orgId);
    return kind === 'cached'
      ? deps.usageOnDay(tx, actor, scope, timezone, now, kind)
      : deps.usageOnDay(tx, actor, scope, timezone, now);
  }
  return {
    async recordWindows(
      tx: Tx,
      actor: ActorContext,
      accountId: string,
      windows: LimitWindow[],
    ): Promise<void> {
      system(actor);
      await authorize(tx, actor, 'task.write');
      for (const w of windows) {
        if (
          !['5h', 'weekly'].includes(w.window) ||
          !Number.isFinite(w.usedPercent) ||
          w.usedPercent < 0 ||
          (w.resetsAt !== null && !Number.isFinite(Date.parse(w.resetsAt)))
        )
          throw invalid('Invalid limit window');
        await tx.insert(usageSnapshots).values({
          orgId: actor.orgId,
          accountId,
          window: w.window,
          usedPercent: w.usedPercent,
          resetsAt: w.resetsAt ? new Date(w.resetsAt) : null,
        });
      }
    },
    /** When the newest window snapshot of the account was taken; null when there is none. */
    async snapshotsUpdatedAt(db: Db, actor: ActorContext, accountId: string): Promise<Date | null> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read');
        const rows = await latestRows(tx, actor, accountId);
        return rows.map((r) => r.ts).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      });
    },
    /** The reserve rule's verdict for display; null when no threshold is hit by a fresh snapshot. */
    async reserveStatus(
      db: Db,
      actor: ActorContext,
      accountId: string,
      stopAt: AccountLimits['stopAt'],
      now = new Date(),
    ): Promise<string | null> {
      if (!stopAt) return null;
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read');
        const rows = await latestRows(tx, actor, accountId);
        return (
          reserveReached(
            rows.map((r) => ({
              window: r.window,
              usedPercent: r.usedPercent,
              resetsAt: r.resetsAt?.toISOString() ?? null,
              observedAt: r.ts,
            })),
            stopAt,
            now,
          )?.detail ?? null
        );
      });
    },
    async latestWindows(db: Db, actor: ActorContext, accountId: string): Promise<LimitWindow[]> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read');
        return latest(tx, actor, accountId);
      });
    },
    async costOn(
      db: Db,
      actor: ActorContext,
      accountId: string,
      period: 'day' | 'month',
      now = new Date(),
    ): Promise<number> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read');
        const { timezone } = await deps.orgSettings.get(tx, actor.orgId);
        return (await deps.costOnPeriod?.(tx, actor, accountId, timezone, now, period)) ?? 0;
      });
    },
    async tokensToday(db: Db, actor: ActorContext, scope: UsageScope, now = new Date()): Promise<number> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read', scope);
        return tokens(tx, actor, scope, now);
      });
    },
    async cachedTokensToday(
      db: Db,
      actor: ActorContext,
      scope: UsageScope,
      now = new Date(),
    ): Promise<number> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read', scope);
        return tokens(tx, actor, scope, now, 'cached');
      });
    },
    async blockAccount(tx: Tx, actor: ActorContext, accountId: string, until: Date): Promise<void> {
      system(actor);
      await authorize(tx, actor, 'task.write');
      if (!Number.isFinite(until.getTime())) throw invalid('Invalid reset time');
      const [existing] = await tx
        .select({ until: accountBlocks.until })
        .from(accountBlocks)
        .where(and(eq(accountBlocks.orgId, actor.orgId), eq(accountBlocks.accountId, accountId)));
      await tx
        .insert(accountBlocks)
        .values({ orgId: actor.orgId, accountId, until })
        .onConflictDoUpdate({
          target: [accountBlocks.orgId, accountBlocks.accountId],
          set: { until: sql`greatest(${accountBlocks.until},${until.toISOString()}::timestamptz)` },
        });
      if (!existing || existing.until.getTime() < until.getTime())
        await deps.audit.append(tx, {
          orgId: actor.orgId,
          actorId: actor.principalId,
          action: 'usage.update',
          targetType: 'account',
          targetId: accountId,
          data: { blockedUntil: until.toISOString() },
        });
    },
    async accountBlock(
      db: Db,
      actor: ActorContext,
      accountId: string,
      now = new Date(),
    ): Promise<Date | null> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read');
        return block(tx, actor, accountId, now);
      });
    },
    async accountAvailability(
      db: Db,
      actor: ActorContext,
      accountId: string,
      limits: AccountLimits,
      now = new Date(),
    ): Promise<Availability> {
      return db.transaction(async (tx) => {
        await authorize(tx, actor, 'read');
        if (
          !Number.isInteger(limits.maxConcurrentRuns) ||
          limits.maxConcurrentRuns < 1 ||
          (limits.dailyTokenBudget !== undefined &&
            (!Number.isFinite(limits.dailyTokenBudget) || limits.dailyTokenBudget < 0))
        )
          throw invalid('Invalid account limits');
        const reset = await block(tx, actor, accountId, now);
        if (reset) return { ok: false, reason: 'rate_limited', resetsAt: reset };
        if ((await deps.runningCount(tx, actor, accountId)) >= limits.maxConcurrentRuns)
          return { ok: false, reason: 'concurrency' };
        if (
          limits.dailyTokenBudget !== undefined &&
          (await tokens(tx, actor, { accountId }, now)) >= limits.dailyTokenBudget
        )
          return { ok: false, reason: 'daily_budget' };
        if (limits.dailyCostBudgetUsd !== undefined && deps.costOnPeriod) {
          const { timezone } = await deps.orgSettings.get(tx, actor.orgId);
          if (
            (await deps.costOnPeriod(tx, actor, accountId, timezone, now, 'day')) >= limits.dailyCostBudgetUsd
          )
            return { ok: false, reason: 'daily_cost_budget' };
        }
        if (limits.stopAt) {
          const rows = await latestRows(tx, actor, accountId);
          const hit = reserveReached(
            rows.map((r) => ({
              window: r.window,
              usedPercent: r.usedPercent,
              resetsAt: r.resetsAt?.toISOString() ?? null,
              observedAt: r.ts,
            })),
            limits.stopAt,
            now,
          );
          if (hit) return { ok: false, reason: 'reserve', ...hit };
        }
        return { ok: true };
      });
    },
  };
}
