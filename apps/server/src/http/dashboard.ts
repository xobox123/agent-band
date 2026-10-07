import type { DashboardDto } from '@agent-band/contracts';
import type { ActorContext } from '../platform/actor.ts';
import type { Composition } from '../composition.ts';
import { runDto } from './dto.ts';

export async function buildDashboard(c: Composition, actor: ActorContext): Promise<DashboardDto> {
  const db = c.database.db;
  const cursor = await c.cursor();
  const [accounts, agents, running, queued, tokensToday, cachedTokensToday, recentFailures, tokenBuckets] =
    await Promise.all([
      c.accounts.listAccounts(db, actor),
      c.agents.listAgents(db, actor),
      c.runs.listRuns(db, actor, { status: 'running' }),
      c.tasks.listTasks(db, actor, { status: 'queued' }),
      c.usage.tokensToday(db, actor, {}),
      c.usage.cachedTokensToday(db, actor, {}),
      c.runs.recentFailures(db, actor),
      c.runs.hourlyTokens(db, actor),
    ]);

  const accountRows = await Promise.all(
    accounts.map(async (account) => {
      const [windows, tokens, cached, blockedUntil, updatedAt, reserve, costToday, costMonth] =
        await Promise.all([
          c.usage.latestWindows(db, actor, account.id),
          c.usage.tokensToday(db, actor, { accountId: account.id }),
          c.usage.cachedTokensToday(db, actor, { accountId: account.id }),
          c.usage.accountBlock(db, actor, account.id),
          c.usage.snapshotsUpdatedAt(db, actor, account.id),
          c.usage.reserveStatus(db, actor, account.id, account.limits.stopAt),
          c.usage.costOn(db, actor, account.id, 'day'),
          c.usage.costOn(db, actor, account.id, 'month'),
        ]);
      const runningRuns = running.filter((r) => r.accountId === account.id).length;
      const availabilityReason: DashboardDto['accounts'][number]['availabilityReason'] = blockedUntil
        ? 'blocked'
        : runningRuns >= account.limits.maxConcurrentRuns
          ? 'concurrency_full'
          : account.limits.dailyTokenBudget !== undefined && tokens >= account.limits.dailyTokenBudget
            ? 'budget_exhausted'
            : account.limits.dailyCostBudgetUsd !== undefined &&
                costToday >= account.limits.dailyCostBudgetUsd
              ? 'cost_exhausted'
              : reserve
                ? 'reserve'
                : 'ok';
      return {
        availabilityReason,
        account,
        windows,
        windowsUpdatedAt: updatedAt?.toISOString() ?? null,
        reserveDetail: reserve,
        costToday,
        costThisMonth: costMonth,
        tokensToday: tokens,
        cachedTokensToday: cached,
        runningRuns: running.filter((r) => r.accountId === account.id).length,
        blockedUntil: blockedUntil?.toISOString() ?? null,
      };
    }),
  );
  const agentTokens = await Promise.all(
    agents.map((agent) => c.usage.tokensToday(db, actor, { agentId: agent.id })),
  );
  const blocked = new Set(accountRows.filter((a) => a.blockedUntil !== null).map((a) => a.account.id));

  return {
    cursor,
    accounts: accountRows,
    agents: agents.map((agent, i) => {
      const run = running.find((r) => r.agentId === agent.id);
      const status = !agent.enabled
        ? ('disabled' as const)
        : run
          ? ('running' as const)
          : blocked.has(agent.accountId)
            ? ('blocked' as const)
            : ('idle' as const);
      return { agent, status, runningRunId: run?.id ?? null, tokensToday: agentTokens[i] ?? 0 };
    }),
    runningRuns: running.map(runDto),
    recentFailures: recentFailures.map(runDto),
    tokenBuckets,
    queuedCount: queued.length,
    tokensToday,
    cachedTokensToday,
  };
}
