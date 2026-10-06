import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

export const TaskStatus = z.enum([
  'scheduled',
  'queued',
  'claimed',
  'running',
  'done',
  'failed',
  'rate_limited',
  'cancelled',
  'denied',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskTarget = z.union([
  z.object({ agentId: Id }).strict(),
  z.object({ label: z.string().min(1).max(63) }).strict(),
  z.object({ agentGroupId: Id }).strict(),
]);
export type TaskTarget = z.infer<typeof TaskTarget>;

export const TaskMode = z.enum(['read-only', 'edit', 'full-auto']);
/** 0 = P0 (highest) .. 3 = P3. */
export const TaskPriority = z.number().int().min(0).max(3);

export const TaskKind = z.enum(['task', 'goal', 'review']);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskResult = z.object({
  /** Last assistant text of the run (at most 4 KB), or the leader's final summary. */
  summary: z.string(),
  outcome: z.enum(['success', 'partial', 'failed', 'cancelled']),
});
export type TaskResult = z.infer<typeof TaskResult>;

export const GoalLimits = z.object({
  maxRounds: z.number().int().min(1),
  maxSubtasks: z.number().int().min(1),
  treeTokenBudget: z.number().int().positive().optional(),
});
export type GoalLimits = z.infer<typeof GoalLimits>;

export const GoalLimitsBody = z
  .object({
    maxRounds: z.number().int().min(1).max(100).optional(),
    maxSubtasks: z.number().int().min(1).max(500).optional(),
    treeTokenBudget: z.number().int().positive().optional(),
  })
  .strict();

export const TaskDto = z.object({
  id: Id,
  orgId: Id,
  key: z.string(),
  title: z.string(),
  prompt: z.string(),
  workDir: z.string(),
  target: TaskTarget,
  priority: TaskPriority,
  rank: z.number(),
  mode: TaskMode.nullable(),
  status: TaskStatus,
  /** Set while status is `scheduled`: when the task becomes queued. */
  runAt: IsoDate.nullable(),
  /** Set when a schedule created the task. */
  scheduleId: Id.nullable(),
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().min(1),
  /** Set while status is `rate_limited` and an automatic resume is planned. */
  resumeAt: IsoDate.nullable(),
  workerId: z.string().nullable(),
  /** Failure or "no eligible agent" reason. */
  error: z.string().nullable(),
  /** `goal` tasks are run by a leader agent; `task` and `review` subtasks belong to a goal tree. */
  kind: TaskKind,
  parentTaskId: Id.nullable(),
  /** The goal task at the top of the tree; null for ordinary tasks. */
  rootTaskId: Id.nullable(),
  depth: z.number().int().min(0),
  /** Not claimable until every listed task is done. */
  dependsOn: z.array(Id),
  result: TaskResult.nullable(),
  /** Why a queued task is waiting for an agent (no eligible agent, account limits); null otherwise. */
  eligibilityReason: z.string().nullable(),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type TaskDto = z.infer<typeof TaskDto>;
export const TaskList = listOf(TaskDto);

export const CreateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    workDir: z.string().startsWith('/').max(4096),
    target: TaskTarget,
    priority: TaskPriority.default(2),
    rank: z.number().default(0),
    mode: TaskMode.optional(),
    /** ISO date-time in the future; the task stays `scheduled` until then. */
    runAt: z.iso.datetime({ offset: true }).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    /** `goal` targets a leader agent; it plans and delegates subtasks. */
    kind: z.enum(['task', 'goal']).optional(),
    goalLimits: GoalLimitsBody.optional(),
  })
  .strict();
export type CreateTaskBody = z.input<typeof CreateTaskBody>;

export const TaskQuery = z.object({
  status: TaskStatus.optional(),
  agentId: Id.optional(),
  label: z.string().optional(),
  agentGroupId: Id.optional(),
  text: z.string().max(200).optional(),
});
export type TaskQuery = z.infer<typeof TaskQuery>;

export const ReorderTaskBody = z.object({ beforeId: Id.optional() }).strict();
export const UpdateTaskBody = z.object({ priority: TaskPriority }).strict();

export const BoardColumns = z.object({
  scheduled: z.array(TaskDto),
  queued: z.array(TaskDto),
  running: z.array(TaskDto),
  rate_limited: z.array(TaskDto),
  done: z.array(TaskDto),
  failed: z.array(TaskDto),
  cancelled: z.array(TaskDto),
});
export const BoardDto = z.object({ columns: BoardColumns, cursor: z.number().int().nonnegative() });
export type BoardDto = z.infer<typeof BoardDto>;

export const GoalStatus = z.enum(['planning', 'waiting', 'continuing', 'completed', 'failed']);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const GoalStateDto = z.object({
  rootTaskId: Id,
  orgId: Id,
  round: z.number().int().min(1),
  leaderAgentId: Id.nullable(),
  status: GoalStatus,
  /** Billable tokens (input + output) of all runs in the tree. */
  treeTokensUsed: z.number().nonnegative(),
  limits: GoalLimits,
  /** Final summary from `complete_goal`. */
  summary: z.string().nullable(),
  outcome: TaskResult.shape.outcome.nullable(),
  /** Why the goal failed (budget, rounds, cancellation). */
  reason: z.string().nullable(),
  notes: z.array(z.object({ at: IsoDate, runId: Id, text: z.string() })),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type GoalStateDto = z.infer<typeof GoalStateDto>;

export const GoalListItem = z.object({ goal: GoalStateDto, task: TaskDto });
export type GoalListItem = z.infer<typeof GoalListItem>;
export const GoalList = listOf(GoalListItem);

export const TreeTaskDto = TaskDto.extend({ tokens: z.number().nonnegative() });
export type TreeTaskDto = z.infer<typeof TreeTaskDto>;

export const TaskTreeDto = z.object({
  goal: GoalStateDto,
  /** The goal task first, then its subtasks in creation order. */
  tasks: z.array(TreeTaskDto),
  cursor: z.number().int().nonnegative(),
});
export type TaskTreeDto = z.infer<typeof TaskTreeDto>;
