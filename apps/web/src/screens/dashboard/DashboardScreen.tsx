import { useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { AgentHoverCard } from '../../components/AgentHoverCard.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LimitBar } from '../../components/LimitBar.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime } from '../../lib/format.ts';
import { exactCount } from '../board/format.ts';
import { AgentDetails } from '../agents/AgentDetails.tsx';

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
                    <span className="dim">Usage may update during a run</span>
                  </div>
                </div>
                <h2 className="section-title section-pad">Accounts</h2>
                <div className="cards" aria-label="Accounts">
                  {d.accounts.map(({ account, windows, tokensToday, runningRuns, blockedUntil }) => {
                    const budget = account.limits.dailyTokenBudget;
                    return (
                      <article key={account.id} className="panel" aria-label={`Account ${account.name}`}>
                        <div className="panel-row">
                          <strong>{account.name}</strong>
                          <span className="chip">{`${account.provider} / ${account.type}`}</span>
                        </div>
                        {(['5h', 'weekly'] as const).map((w) => {
                          const win = windows.find((x) => x.window === w);
                          return (
                            <div key={w} className="panel-row">
                              <span>{w === '5h' ? '5h window' : 'Weekly window'}</span>
                              <LimitBar
                                value={win ? win.usedPercent : null}
                                label={`${account.name} ${w}`}
                                title={win?.resetsAt ? `Resets ${formatTime(win.resetsAt)}` : undefined}
                              />
                            </div>
                          );
                        })}
                        <div className="panel-row">
                          <span>Tokens today</span>
                          <span>
                            {budget
                              ? `${exactCount(tokensToday)} / ${exactCount(budget)}`
                              : `${exactCount(tokensToday)} (no budget set)`}
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
                      </article>
                    );
                  })}
                </div>
                <h2 className="section-title section-pad">Agents</h2>
                <ul className="plain-list section-pad" aria-label="Agents">
                  {d.agents.map(({ agent, status, runningRunId }) => (
                    <li key={agent.id} className="panel-row">
                      <AgentHoverCard
                        agent={{
                          ...agent,
                          status,
                          provider: accountOf(agent.accountId)?.provider,
                          accountName: accountOf(agent.accountId)?.name,
                          runningRunId,
                        }}
                        onOpen={setAgentId}
                      />
                      <StatusDot kind="agent" value={status} />
                    </li>
                  ))}
                </ul>
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
