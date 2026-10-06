import type { DashboardDto } from '@agent-band/contracts';
import type { ActorContext } from '../platform/actor.ts';
import type { Composition } from '../composition.ts';
import { runDto } from './dto.ts';

export async function buildDashboard(c: Composition, actor: ActorContext): Promise<DashboardDto> {
  const db = c.database.db;
  const cursor = await c.cursor();
  const [accounts, agents, running, queued, tokensToday] = await Promise.all([
    c.accounts.listAccounts(db, actor),
    c.agents.listAgents(db, actor),
    c.runs.listRuns(db, actor, { status: 'running' }),
    c.tasks.listTasks(db, actor, { status: 'queued' }),
    c.usage.tokensToday(db, actor, {}),
  ]);

  const accountRows = await Promise.all(
    accounts.map(async (account) => {
      const [windows, tokens, blockedUntil] = await Promise.all([
        c.usage.latestWindows(db, actor, account.id),
        c.usage.tokensToday(db, actor, { accountId: account.id }),
        c.usage.accountBlock(db, actor, account.id),
      ]);
      return {
        account,
        windows,
        tokensToday: tokens,
        runningRuns: running.filter((r) => r.accountId === account.id).length,
        blockedUntil: blockedUntil?.toISOString() ?? null,
      };
    }),
  );
  const blocked = new Set(accountRows.filter((a) => a.blockedUntil !== null).map((a) => a.account.id));

  return {
    cursor,
    accounts: accountRows,
    agents: agents.map((agent) => {
      const run = running.find((r) => r.agentId === agent.id);
      const status = !agent.enabled
        ? ('disabled' as const)
        : run
          ? ('running' as const)
          : blocked.has(agent.accountId)
            ? ('blocked' as const)
            : ('idle' as const);
      return { agent, status, runningRunId: run?.id ?? null };
    }),
    runningRuns: running.map(runDto),
    queuedCount: queued.length,
    tokensToday,
  };
}
