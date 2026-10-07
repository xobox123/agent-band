import type { DashboardDto } from '@agent-band/contracts';
import { useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { AgentHoverCard } from '../../components/AgentHoverCard.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import {
  AccountActions,
  AccountIdentity,
  AccountLimits,
  UsageExtras,
} from '../../components/AccountStatus.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatCost, formatTime } from '../../lib/format.ts';
import { exactCount } from '../board/format.ts';
import { AgentDetails } from '../agents/AgentDetails.tsx';

type AgentRow = DashboardDto['agents'][number];

function agentColumns(
  d: DashboardDto,
  accountOf: (id: string) => DashboardDto['accounts'][number]['account'] | undefined,
  open: (id: string) => void,
): Column<AgentRow>[] {
  return [
    {
      id: 'name',
      header: 'Agent',
      sortValue: (r) => r.agent.name,
      cell: ({ agent, status, runningRunId }) => (
        <AgentHoverCard
          agent={{
            ...agent,
            status,
            provider: accountOf(agent.accountId)?.provider,
            accountName: accountOf(agent.accountId)?.name,
            runningRunId,
          }}
          onOpen={open}
        />
      ),
    },
    { id: 'role', header: 'Role', sortValue: (r) => r.agent.role, cell: (r) => r.agent.role },
    {
      id: 'model',
      header: 'Model',
      sortValue: (r) => r.agent.model ?? '',
      cell: (r) => r.agent.model ?? 'Provider default',
    },
    {
      id: 'account',
      header: 'Account',
      sortValue: (r) => accountOf(r.agent.accountId)?.name ?? '',
      cell: (r) => accountOf(r.agent.accountId)?.name ?? 'Deleted account',
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      cell: (r) => <StatusDot kind="agent" value={r.status} />,
    },
    {
      id: 'tokens',
      header: 'Tokens today',
      sortValue: (r) => r.tokensToday,
      cell: (r) => exactCount(r.tokensToday),
    },
    {
      id: 'run',
      header: 'Current run',
      cell: (r) => {
        const run = d.runningRuns.find((x) => x.id === r.runningRunId);
        return run ? (
          <span className="mono">{`${run.id.slice(0, 8)} since ${formatTime(run.startedAt)}`}</span>
        ) : (
          <span className="dim">None</span>
        );
      },
    },
  ];
}

export function DashboardScreen() {
  const api = useApi();
  const state = useResource(() => api.dashboard(), [], ['task.', 'run.updated', 'agent', 'account.']);
  const [agentId, setAgentId] = useState<string | null>(null);
  useItemCount(state.data?.agents.length ?? null);

  return (
    <div className="screen">
      <Toolbar label="Dashboard toolbar">
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load dashboard data. Retry.">
          {(d) => {
            const accountOf = (id: string) => d.accounts.find((a) => a.account.id === id)?.account;
            if (d.accounts.length === 0 && d.agents.length === 0) {
              return <EmptyState title="No activity yet. Add an account and agent, then create a task." />;
            }
            return (
              <>
                <div className="cards" aria-label="Totals">
                  <div className="panel">
                    <h3>Running runs</h3>
                    <strong>{d.runningRuns.length}</strong>
                  </div>
                  <div className="panel">
                    <h3>Queued tasks</h3>
                    <strong>{d.queuedCount}</strong>
                  </div>
                  <div className="panel">
                    <h3>Tokens today</h3>
                    <strong>{exactCount(d.tokensToday)}</strong>
                    {d.cachedTokensToday > 0 ? (
                      <span className="dim">{`+ ${exactCount(d.cachedTokensToday)} cached`}</span>
                    ) : null}
                    <span className="dim">Usage may update during a run</span>
                  </div>
                </div>
                <h2 className="section-title section-pad">Accounts</h2>
                <div className="cards" aria-label="Accounts">
                  {d.accounts.map(
                    ({
                      account,
                      windows,
                      windowsUpdatedAt,
                      reserveDetail,
                      costToday,
                      costThisMonth,
                      tokensToday,
                      cachedTokensToday,
                      runningRuns,
                      blockedUntil,
                      availabilityReason,
                    }) => {
                      const budget = account.limits.dailyTokenBudget;
                      return (
                        <article key={account.id} className="panel" aria-label={`Account ${account.name}`}>
                          <div className="panel-row">
                            <strong>{account.name}</strong>
                            <span className="dim">{availabilityReason}</span>
                            <span className="chip">{`${account.provider} / ${account.type}`}</span>
                          </div>
                          <AccountIdentity account={account} />
                          {account.type === 'api' ? (
                            <div className="panel-row">
                              <span>Spend</span>
                              <span>{`${formatCost(costToday)} today, ${formatCost(costThisMonth)} this month`}</span>
                            </div>
                          ) : (
                            <>
                              <AccountLimits
                                account={account}
                                windows={windows}
                                updatedAt={windowsUpdatedAt}
                              />
                              {reserveDetail ? <p className="dim">{reserveDetail}</p> : null}
                              <UsageExtras account={account} />
                            </>
                          )}
                          <div className="panel-row">
                            <span>Tokens today</span>
                            <span className="tokens-cell">
                              {budget
                                ? `${exactCount(tokensToday)} / ${exactCount(budget)}`
                                : `${exactCount(tokensToday)} (no budget set)`}
                              {cachedTokensToday > 0 ? (
                                <span className="dim">{`+ ${exactCount(cachedTokensToday)} cached`}</span>
                              ) : null}
                            </span>
                          </div>
                          <div className="panel-row">
                            <span>Active runs</span>
                            <span>{`${String(runningRuns)} / ${String(account.limits.maxConcurrentRuns)}`}</span>
                          </div>
                          <div className="panel-row">
                            <span>Block</span>
                            {blockedUntil ? (
                              <StatusDot kind="indicator" value="rate_limited" />
                            ) : (
                              <span className="dim">Not blocked</span>
                            )}
                            {blockedUntil ? <span>{`until ${formatTime(blockedUntil)}`}</span> : null}
                          </div>
                          <AccountActions account={account} onChanged={state.reload} />
                        </article>
                      );
                    },
                  )}
                </div>
                <h2 className="section-title section-pad">Agents</h2>
                <div className="section-pad">
                  <Table
                    label="Agents"
                    columns={agentColumns(d, accountOf, setAgentId)}
                    rows={d.agents}
                    getRowId={(row) => row.agent.id}
                    defaultSort={{ columnId: 'name', direction: 'asc' }}
                  />
                </div>
              </>
            );
          }}
        </Resource>
      </div>
      {agentId ? (
        <AgentDetails
          agentId={agentId}
          onClose={() => {
            setAgentId(null);
          }}
        />
      ) : null}
    </div>
  );
}
