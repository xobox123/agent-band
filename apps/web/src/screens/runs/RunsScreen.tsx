import type { RunDto } from '@agent-band/contracts';
import { useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { AgentHoverCard } from '../../components/AgentHoverCard.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { FilterInput } from '../../components/FilterInput.tsx';
import { FilterSelect } from '../../components/FilterSelect.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { statusValues } from '../../components/statusInfo.ts';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useResource } from '../../hooks/useResource.ts';
import { useItemCount, useWorkspace } from '../../layout/WorkspaceContext.tsx';
import { formatCost, formatTime, shortId } from '../../lib/format.ts';
import { AgentDetails } from '../agents/AgentDetails.tsx';
import { exactCount, formatDuration } from '../board/format.ts';
import { RunLog } from './RunLog.tsx';

export function RunsScreen() {
  const api = useApi();
  const { openDock } = useWorkspace();
  const [status, setStatus] = useState<string | null>(null);
  const state = useResource(
    async () => {
      const [runs, agents, accounts, tasks] = await Promise.all([
        api.runs.list(status ? { status } : undefined),
        api.agents.list(),
        api.accounts.list(),
        api.tasks.list(),
      ]);
      return { runs: runs.items, agents: agents.items, accounts: accounts.items, tasks: tasks.items };
    },
    [status],
    ['run.updated', 'task.', 'agent'],
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  const text = search.trim().toLowerCase();
  const taskKey = (id: string) => state.data?.tasks.find((t) => t.id === id)?.key ?? shortId(id);
  const all = state.data?.runs ?? [];
  const rows = all.filter(
    (r) => text === '' || r.id.toLowerCase().includes(text) || taskKey(r.taskId).toLowerCase().includes(text),
  );
  useItemCount(state.data ? rows.length : null);
  const run = all.find((r) => r.id === selected);

  const openLog = (r: RunDto) => {
    openDock({ title: `Run log ${shortId(r.id)}`, body: <RunLog key={r.id} runId={r.id} /> });
  };

  const agentCell = (r: RunDto) => {
    const agent = state.data?.agents.find((a) => a.id === r.agentId);
    if (!agent) return `Deleted agent ${shortId(r.agentId)}`;
    const account = state.data?.accounts.find((a) => a.id === agent.accountId);
    return (
      <AgentHoverCard
        agent={{
          ...agent,
          status: !agent.enabled ? 'disabled' : r.status === 'running' ? 'running' : 'idle',
          provider: account?.provider,
          accountName: account?.name,
          runningRunId: r.status === 'running' ? r.id : null,
        }}
        onOpen={setAgentId}
        size={18}
      />
    );
  };

  const duration = (r: RunDto) =>
    formatDuration((r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt));

  const columns: Column<RunDto>[] = [
    {
      id: 'run',
      header: 'Run',
      sortValue: (r) => r.id,
      cell: (r) => <span className="mono">{shortId(r.id)}</span>,
    },
    { id: 'task', header: 'Task', cell: (r) => taskKey(r.taskId) },
    { id: 'agent', header: 'Agent', cell: agentCell },
    {
      id: 'account',
      header: 'Account',
      cell: (r) =>
        state.data?.accounts.find((a) => a.id === r.accountId)?.name ??
        `Deleted account ${shortId(r.accountId)}`,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      cell: (r) => <StatusDot kind="run" value={r.status} />,
    },
    { id: 'started', header: 'Started', sortValue: (r) => r.startedAt, cell: (r) => formatTime(r.startedAt) },
    { id: 'duration', header: 'Duration', cell: duration },
    { id: 'in', header: 'Input', sortValue: (r) => r.inputTokens, cell: (r) => exactCount(r.inputTokens) },
    {
      id: 'out',
      header: 'Output',
      sortValue: (r) => r.outputTokens,
      cell: (r) => exactCount(r.outputTokens),
    },
    {
      id: 'cached',
      header: 'Cached',
      sortValue: (r) => r.cachedTokens,
      cell: (r) => exactCount(r.cachedTokens),
    },
    { id: 'cost', header: 'Cost', sortValue: (r) => r.costUsd ?? -1, cell: (r) => formatCost(r.costUsd) },
    {
      id: 'worker',
      header: 'Worker',
      sortValue: (r) => r.workerId,
      cell: (r) => <span className="mono">{r.workerId}</span>,
    },
  ];

  return (
    <div className="screen">
      <Toolbar label="Runs toolbar">
        <FilterInput
          label="Search runs"
          placeholder="Search run ID or task key (/)"
          value={search}
          onChange={setSearch}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={statusValues('run').map((v) => ({ value: v, label: v }))}
        />
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load runs. Retry.">
          {() =>
            all.length === 0 && !status ? (
              <EmptyState title="No runs yet. Runs appear when tasks start." />
            ) : rows.length === 0 ? (
              <EmptyState title="No matches. Clear filters to see all items." />
            ) : (
              <Table
                label="Runs"
                columns={columns}
                rows={rows}
                getRowId={(r) => r.id}
                selectedId={selected}
                onSelect={(r) => {
                  setSelected(r.id);
                  setAgentId(null);
                }}
                defaultSort={{ columnId: 'started', direction: 'desc' }}
              />
            )
          }
        </Resource>
      </div>
      {agentId ? (
        <AgentDetails
          agentId={agentId}
          onClose={() => {
            setAgentId(null);
          }}
        />
      ) : run ? (
        <DetailsPanel
          title={`Run ${shortId(run.id)}`}
          subtitle={run.id}
          onClose={() => {
            setSelected(null);
          }}
          footer={
            <button
              type="button"
              className="btn"
              onClick={() => {
                openLog(run);
              }}
            >
              Open logs
            </button>
          }
        >
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <StatusDot kind="run" value={run.status} />
            </dd>
            <dt>Task</dt>
            <dd>{taskKey(run.taskId)}</dd>
            <dt>Started</dt>
            <dd>{formatTime(run.startedAt)}</dd>
            <dt>Finished</dt>
            <dd>{run.finishedAt ? formatTime(run.finishedAt) : 'Not finished'}</dd>
            <dt>Exit code</dt>
            <dd>{run.exitCode ?? 'Unknown'}</dd>
            <dt>Rate limit reset</dt>
            <dd>{run.rateLimitResetsAt ? formatTime(run.rateLimitResetsAt) : 'Not rate limited'}</dd>
            <dt>Tokens</dt>
            <dd>{`Input ${exactCount(run.inputTokens)}, output ${exactCount(run.outputTokens)}, cached ${exactCount(run.cachedTokens)}`}</dd>
            <dt>Cost</dt>
            <dd>{formatCost(run.costUsd)}</dd>
            <dt>Worker</dt>
            <dd className="mono">{run.workerId}</dd>
          </dl>
          {run.error ? (
            <>
              <h3 className="section-title">Error</h3>
              <p>{run.error}</p>
            </>
          ) : null}
          <h3 className="section-title">Policy snapshot</h3>
          <pre className="prompt">{JSON.stringify(run.effectivePolicy, null, 2)}</pre>
          <h3 className="section-title">Skills snapshot</h3>
          {run.skills.length === 0 ? <p className="dim">No skills loaded</p> : null}
          <ul className="plain-list">
            {run.skills.map((s) => (
              <li key={s.skillId} className="mono" title={s.contentHash}>
                {`${shortId(s.skillId)} v${String(s.version)} ${s.contentHash.slice(0, 12)}`}
              </li>
            ))}
          </ul>
        </DetailsPanel>
      ) : null}
    </div>
  );
}
