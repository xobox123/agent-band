import { z } from 'zod';
import { Id, IsoDate, listOf, PagingQuery } from './common.ts';

export const TaskStatus = z.enum([
  'draft',
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

export const GoalApproval = z.enum(['auto', 'required']);
export type GoalApproval = z.infer<typeof GoalApproval>;

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

import { RunDto } from './runs.ts';

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
  /** A subtask proposed by a leader under plan approval (a draft until the plan is approved). */
  proposed: z.boolean(),
  /** The task was started with "when limits reset": runAt is the reset time. */
  startAfterReset: z.boolean(),
  result: TaskResult.nullable(),
  /** Why a queued task is waiting for an agent (no eligible agent, account limits); null otherwise. */
  latestRun: RunDto.pick({
    id: true,
    agentId: true,
    status: true,
    inputTokens: true,
    outputTokens: true,
    startedAt: true,
    finishedAt: true,
  }).nullable(),
  eligibilityReason: z.string().nullable(),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type TaskDto = z.infer<typeof TaskDto>;
export const TaskList = listOf(TaskDto).extend({ nextCursor: z.string().nullable() });

export const CreateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    /** Omit to get a folder under the workspace root named after the task key. */
    workDir: z.string().startsWith('/').max(4096).optional(),
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
    /** Create in the backlog (status `draft`); nothing runs until it is started. */
    draft: z.boolean().optional(),
    /** Not claimable until every listed task is done. */
    dependsOn: z.array(Id).max(50).optional(),
    /** Goals only: `required` makes the leader's plan wait for human approval. */
    approval: GoalApproval.optional(),
  })
  .strict();
export type CreateTaskBody = z.input<typeof CreateTaskBody>;

export const TaskQuery = PagingQuery.extend({
  accountId: Id.optional(),
  status: TaskStatus.optional(),
  agentId: Id.optional(),
  label: z.string().optional(),
  agentGroupId: Id.optional(),
  text: z.string().max(200).optional(),
});
export type TaskQuery = z.infer<typeof TaskQuery>;

export const ReorderTaskBody = z.object({ beforeId: Id.optional() }).strict();
export const UpdateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    workDir: z.string().startsWith('/').max(4096),
    target: TaskTarget,
    priority: TaskPriority,
    mode: TaskMode.nullable(),
    runAt: z.iso.datetime({ offset: true }).nullable(),
    maxAttempts: z.number().int().min(1).max(20),
    dependsOn: z.array(Id).max(50),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');
export type UpdateTaskBody = z.input<typeof UpdateTaskBody>;

/** When a started task becomes claimable. */
export const StartWhen = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('now') }).strict(),
  z.object({ mode: z.literal('at'), at: z.iso.datetime({ offset: true }) }).strict(),
  /** At the reset of the target account's limit window; behaves like `now` without a usage snapshot. */
  z.object({ mode: z.literal('limit_reset') }).strict(),
]);
export type StartWhen = z.infer<typeof StartWhen>;
export const StartTaskBody = z.object({ when: StartWhen.default({ mode: 'now' }) }).strict();
export const StartTasksBody = z
  .object({ ids: z.array(Id).min(1).max(200), when: StartWhen.default({ mode: 'now' }) })
  .strict();
export type StartTasksBody = z.input<typeof StartTasksBody>;
export const ToBacklogBody = z.object({ ids: z.array(Id).min(1).max(200) }).strict();
export type ToBacklogBody = z.infer<typeof ToBacklogBody>;
export const ApprovePlanBody = StartTaskBody;
export const RejectPlanBody = z.object({ feedback: z.string().trim().min(1).max(4000) }).strict();
export const AddPlanTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    workDir: z.string().startsWith('/').max(4096).optional(),
    target: TaskTarget,
    priority: TaskPriority.default(2),
    mode: TaskMode.optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    dependsOn: z.array(Id).max(50).optional(),
  })
  .strict();
export type AddPlanTaskBody = z.input<typeof AddPlanTaskBody>;

export const BoardColumns = z.object({
  draft: z.array(TaskDto),
  scheduled: z.array(TaskDto),
  queued: z.array(TaskDto),
  running: z.array(TaskDto),
  rate_limited: z.array(TaskDto),
  done: z.array(TaskDto),
  failed: z.array(TaskDto),
  cancelled: z.array(TaskDto),
});
export const BoardDto = z.object({
  columns: BoardColumns,
  nextCursors: z.object({
    done: z.string().nullable(),
    failed: z.string().nullable(),
    cancelled: z.string().nullable(),
  }),
  cursor: z.number().int().nonnegative(),
});
export type BoardDto = z.infer<typeof BoardDto>;

export const GoalStatus = z.enum([
  'planning',
  'awaiting_approval',
  'waiting',
  'continuing',
  'completed',
  'failed',
]);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const GoalStateDto = z.object({
  rootTaskId: Id,
  orgId: Id,
  round: z.number().int().min(1),
  leaderAgentId: Id.nullable(),
  status: GoalStatus,
  approval: GoalApproval,
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
