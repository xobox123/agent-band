// Board view models. Status enums and DTOs come from @agent-band/contracts; src/data/adapt.ts maps DTOs here.
import type { AgentStatus, GoalStatus, RunStatus, StartWhen, TaskStatus } from '@agent-band/contracts';

export type { AgentStatus, GoalStatus, RunStatus, StartWhen, TaskStatus };

/** 0 is highest (P0), 3 is lowest (P3). Default is 2. */
export type Priority = 0 | 1 | 2 | 3;

export type TaskTarget =
  | { type: 'agent'; agentId: string }
  | { type: 'label'; label: string }
  | { type: 'group'; agentGroupId: string };

export interface Task {
  id: string;
  key: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  priority: Priority;
  rank: number;
  target: TaskTarget;
  workDir: string;
  mode: 'read-only' | 'edit' | 'full-auto' | null;
  kind: 'task' | 'goal' | 'review';
  parentTaskId: string | null;
  /** A leader's proposal waiting for plan approval. */
  proposed: boolean;
  dependsOn: string[];
  /** The scheduled start is the reset of an account limit window. */
  startAfterReset: boolean;
  /** Latest run, if any. */
  runId: string | null;
  /** When a scheduled task is released. */
  runAt: string | null;
  scheduleId: string | null;
  attempt: number;
  maxAttempts: number;
  /** Planned automatic resume of a rate-limited task. */
  resumeAt: string | null;
  error: string | null;
  /** Dispatcher-supplied reason when a queued task has no eligible agent. */
  noEligibleReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  agentId: string;
  accountId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  rateLimitResetsAt: string | null;
  error: string | null;
}

export interface AvatarSpec {
  initials?: string;
  /** Approved theme token name, e.g. "av-3". */
  color?: string;
  url?: string;
}

export interface Agent {
  id: string;
  name: string;
  handle: string;
  role: 'leader' | 'worker' | 'reviewer';
  enabled: boolean;
  paused: boolean;
  accountId: string;
  model: string | null;
  labels: string[];
  groupIds: string[];
  avatar: AvatarSpec | null;
  /** Dashboard status; derived from enabled when the dashboard is unavailable. */
  status: AgentStatus;
  runningRunId: string | null;
}

export interface Account {
  id: string;
  name: string;
  provider: string;
  dailyTokenBudget: number | null;
  tokensToday: number;
  paused: boolean;
}

export interface AgentGroup {
  id: string;
  name: string;
}

export interface BoardFilter {
  text: string;
  agentId: string | null;
  label: string | null;
  accountId: string | null;
}

export interface GoalInfo {
  rootTaskId: string;
  status: GoalStatus;
  approval: 'auto' | 'required';
  round: number;
  leaderAgentId: string | null;
}

export interface BoardSnapshot {
  /** Latest outbox id at read time. */
  cursor: string;
  /** Tasks matching the filter. */
  tasks: Task[];
  /** Runs of the returned tasks. */
  runs: Run[];
  /** All agents, accounts and groups (unfiltered) for filter options. */
  agents: Agent[];
  accounts: Account[];
  groups: AgentGroup[];
  goals: GoalInfo[];
  org: { paused: boolean; workspaceRoot: string };
}

export interface BoardEvent {
  cursor: string;
}

export interface NewTask {
  title: string;
  prompt: string;
  /** Omit to use a folder under the workspace root. */
  workDir?: string;
  target: TaskTarget;
  priority: Priority;
  mode?: 'read-only' | 'edit' | 'full-auto';
  /** ISO date-time in the future. */
  runAt?: string;
  maxAttempts?: number;
  /** Create in the backlog instead of the queue. */
  draft?: boolean;
  kind?: 'task' | 'goal';
  approval?: 'auto' | 'required';
}

export interface TaskPatch {
  title?: string;
  prompt?: string;
  workDir?: string;
  target?: TaskTarget;
  priority?: Priority;
  mode?: 'read-only' | 'edit' | 'full-auto' | null;
  runAt?: string | null;
  maxAttempts?: number;
  dependsOn?: string[];
}
