import type { Account, Agent, AgentGroup, BoardSnapshot, Priority, Run, Task } from '../../data/types.ts';
import type { AgentHoverInfo } from '../../components/AgentHoverCard.tsx';
import { formatDuration } from './format.ts';

export type ColumnId = 'scheduled' | 'queued' | 'running' | 'rate_limited' | 'done' | 'failed' | 'cancelled';

export interface ColumnDef {
  id: ColumnId;
  title: string;
  statuses: Task['status'][];
  empty: string;
}

export const COLUMNS: ColumnDef[] = [
  { id: 'scheduled', title: 'Scheduled', statuses: ['scheduled'], empty: 'No scheduled tasks' },
  { id: 'queued', title: 'Queued', statuses: ['queued'], empty: 'No queued tasks' },
  { id: 'running', title: 'Running', statuses: ['claimed', 'running'], empty: 'No running tasks' },
  { id: 'rate_limited', title: 'Rate limited', statuses: ['rate_limited'], empty: 'No rate-limited tasks' },
  { id: 'done', title: 'Done', statuses: ['done'], empty: 'No completed tasks' },
  {
    id: 'failed',
    title: 'Failed / Denied',
    statuses: ['failed', 'denied'],
    empty: 'No failed or denied tasks',
  },
  { id: 'cancelled', title: 'Cancelled', statuses: ['cancelled'], empty: 'No cancelled tasks' },
];

export function columnOf(status: Task['status']): ColumnId {
  return COLUMNS.find((c) => c.statuses.includes(status))?.id ?? 'queued';
}

export const CANCELLABLE: Task['status'][] = ['scheduled', 'queued', 'claimed', 'running', 'rate_limited'];

export const PRIORITIES: Priority[] = [0, 1, 2, 3];

export interface Lookup {
  runs: Map<string, Run>;
  agents: Map<string, Agent>;
  accounts: Map<string, Account>;
  groups: Map<string, AgentGroup>;
}

export function buildLookup(snapshot: BoardSnapshot): Lookup {
  return {
    runs: new Map(snapshot.runs.map((r) => [r.id, r])),
    agents: new Map(snapshot.agents.map((a) => [a.id, a])),
    accounts: new Map(snapshot.accounts.map((a) => [a.id, a])),
    groups: new Map(snapshot.groups.map((g) => [g.id, g])),
  };
}

export function sortQueued(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.priority - b.priority || a.rank - b.rank || a.id.localeCompare(b.id));
}

export function sortRecent(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export interface TaskView {
  task: Task;
  run: Run | undefined;
  agent: Agent | undefined;
  account: Account | undefined;
  /** Account the assignee agent is bound to. */
  agentAccount: Account | undefined;
  /** Assignee name or target description. */
  assignee: string;
  /** True when assignee is an actual or explicit agent (avatar applies). */
  hasAgent: boolean;
  labels: { text: string; tip: string }[];
  elapsed: (now: number) => string;
  tokens: number | null;
}

export function viewOf(task: Task, lookup: Lookup): TaskView {
  const run = task.runId ? lookup.runs.get(task.runId) : undefined;
  const explicit = task.target.type === 'agent' ? lookup.agents.get(task.target.agentId) : undefined;
  const agent = (run ? lookup.agents.get(run.agentId) : undefined) ?? explicit;

  let assignee: string;
  if (agent) assignee = agent.name;
  else if (task.status === 'claimed') assignee = 'Assignment pending';
  else if (task.target.type === 'label') assignee = `Label: ${task.target.label}`;
  else if (task.target.type === 'group') {
    assignee = `Group: ${lookup.groups.get(task.target.agentGroupId)?.name ?? task.target.agentGroupId}`;
  } else assignee = `Deleted agent ${task.target.agentId}`;

  const labels: TaskView['labels'] = [];
  const addLabel = (text: string, tip: string) => {
    const existing = labels.find((l) => l.text === text);
    if (existing) existing.tip = `${existing.tip}, ${tip.toLowerCase()}`;
    else labels.push({ text, tip });
  };
  if (task.target.type === 'label') addLabel(task.target.label, 'Target label');
  for (const label of run ? (agent?.labels ?? []) : []) {
    addLabel(label, `Agent label (${agent?.name ?? ''})`);
  }

  const account = run
    ? lookup.accounts.get(run.accountId)
    : explicit && lookup.accounts.get(explicit.accountId);
  const tokens =
    run && (run.inputTokens !== null || run.outputTokens !== null)
      ? (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
      : null;

  return {
    task,
    run,
    agent,
    account,
    agentAccount: agent ? lookup.accounts.get(agent.accountId) : undefined,
    assignee,
    hasAgent: agent !== undefined,
    labels,
    tokens,
    elapsed: (now) => {
      if (!run) return 'Not started';
      const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
      return formatDuration(end - Date.parse(run.startedAt));
    },
  };
}

/** Agent used for swimlanes; null means "Unassigned targets". */
export function laneOf(view: TaskView): { key: string; name: string } {
  return view.agent
    ? { key: view.agent.id, name: view.agent.name }
    : { key: '__unassigned', name: 'Unassigned targets' };
}

export function hoverInfoOf(agent: Agent, account: Account | undefined): AgentHoverInfo {
  return {
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    avatar: agent.avatar,
    model: agent.model,
    role: agent.role,
    status: agent.status,
    provider: account?.provider,
    accountName: account?.name,
    runningRunId: agent.runningRunId,
  };
}
