import type {
  Account,
  Agent,
  AgentGroup,
  BoardSnapshot,
  GoalInfo,
  Priority,
  Run,
  Task,
} from '../../data/types.ts';
import type { AgentHoverInfo } from '../../components/AgentHoverCard.tsx';
import { formatDuration } from './format.ts';

export type ColumnId =
  'draft' | 'scheduled' | 'queued' | 'running' | 'rate_limited' | 'done' | 'failed' | 'cancelled';

export interface ColumnDef {
  id: ColumnId;
  title: string;
  statuses: Task['status'][];
  empty: string;
}

export const COLUMNS: ColumnDef[] = [
  { id: 'draft', title: 'Backlog', statuses: ['draft'], empty: 'Backlog is empty' },
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

/** Backlog tasks that can be started directly (leader proposals start with their plan). */
export const startable = (t: Task): boolean => t.status === 'draft' && !t.proposed;

export const PRIORITIES: Priority[] = [0, 1, 2, 3];

export interface Lookup {
  runs: Map<string, Run>;
  agents: Map<string, Agent>;
  accounts: Map<string, Account>;
  groups: Map<string, AgentGroup>;
  tasks: Map<string, Task>;
  goals: Map<string, GoalInfo>;
}

/** Backlog actions the board offers on draft cards. */
export interface BacklogApi {
  selected: Set<string>;
  toggle: (taskId: string) => void;
  start: (taskId: string) => void;
  edit: (taskId: string) => void;
  remove: (taskId: string) => void;
  review: (goalId: string) => void;
}

export function buildLookup(snapshot: BoardSnapshot): Lookup {
  return {
    runs: new Map(snapshot.runs.map((r) => [r.id, r])),
    agents: new Map(snapshot.agents.map((a) => [a.id, a])),
    accounts: new Map(snapshot.accounts.map((a) => [a.id, a])),
    groups: new Map(snapshot.groups.map((g) => [g.id, g])),
    tasks: new Map(snapshot.tasks.map((t) => [t.id, t])),
    goals: new Map(snapshot.goals.map((g) => [g.rootTaskId, g])),
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
  /** Name of the leader that proposed this subtask. */
  proposedBy: string | null;
  /** Plan state when this task is a goal. */
  goal: GoalInfo | undefined;
}

function proposerOf(task: Task, lookup: Lookup): string {
  const parent = task.parentTaskId ? lookup.tasks.get(task.parentTaskId) : undefined;
  const goal = parent ? lookup.goals.get(parent.id) : undefined;
  const leaderId =
    goal?.leaderAgentId ?? (parent?.target.type === 'agent' ? parent.target.agentId : undefined);
  return (leaderId ? lookup.agents.get(leaderId)?.name : undefined) ?? 'the leader';
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
    proposedBy: task.proposed ? proposerOf(task, lookup) : null,
    goal: lookup.goals.get(task.id),
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
