import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { AppError, conflict, forbidden, invalid, notFound } from '../../../platform/errors.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { ModuleDeps } from '../../../ports/index.ts';
import type { AgentDto, createAgentUseCases } from '../../agents/index.ts';
import { isPathWithin, type EffectivePolicy, type Mode } from '../../policy/index.ts';
import type { createRuns } from '../../runs/index.ts';
import {
  MAX_DEPTH,
  RESULT_SUMMARY_MAX_BYTES,
  truncateBytes,
  type GoalState,
  type Task,
  type TaskResult,
  type TaskTarget,
  type createTasks,
} from '../../tasks/index.ts';
import {
  CompleteGoalInput,
  CreateSubtaskInput,
  DelegateAgentFilter,
  RequestReviewInput,
  agentAllowed,
  capSubtaskMode,
  effectiveLimit,
} from '../domain/rules.ts';

export interface DelegationDeps extends ModuleDeps {
  tasks: ReturnType<typeof createTasks>;
  runs: Pick<ReturnType<typeof createRuns>, 'getRun' | 'tokensByTask'>;
  agents: Pick<ReturnType<typeof createAgentUseCases>, 'getAgent' | 'listAgents'>;
  /** Run-token check from the execution module. */
  verifyRunToken(
    db: Db,
    runId: string,
    token: string,
  ): Promise<{ runId: string; orgId: string; agentId: string } | null>;
}

/** Proven identity and limits of one running leader turn; every delegation call takes it. */
export interface RunContext {
  orgId: string;
  runId: string;
  /** Task the run executes. */
  taskId: string;
  /** Goal task this run belongs to (its own task for a leader run). */
  rootTaskId: string;
  task: Task;
  leaderAgentId: string;
  /** The leader as audit actor. */
  actor: ActorContext;
  policy: EffectivePolicy;
  /** Mode the leader run itself was granted. */
  mode: Mode;
  /** Mode subtasks are capped by: the leader's mode before the plan-approval read-only cap. */
  delegationMode: Mode;
}

export interface DelegateAgentView {
  id: string;
  handle: string;
  name: string;
  role: AgentDto['role'];
  labels: string[];
  groupIds: string[];
  model: string | null;
  enabled: boolean;
}

export interface SubtaskView {
  id: string;
  key: string;
  title: string;
  kind: Task['kind'];
  status: Task['status'];
  target: TaskTarget;
  workDir: string;
  mode: Task['mode'];
  dependsOn: string[];
  result: TaskResult | null;
  error: string | null;
  tokens: number;
}

const unauthorized = (): AppError => new AppError('unauthorized', 401, 'Invalid run token');

function toAgentView(a: AgentDto): DelegateAgentView {
  return {
    id: a.id,
    handle: a.handle,
    name: a.name,
    role: a.role,
    labels: a.labels,
    groupIds: a.groupIds,
    model: a.model,
    enabled: a.enabled,
  };
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw invalid(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function createDelegation(deps: DelegationDeps) {
  async function audited<T>(
    db: Db,
    ctx: RunContext,
    action: string,
    fn: (tx: Tx) => Promise<{ value: T; targetId?: string; data?: Record<string, unknown> }>,
  ): Promise<T> {
    const base = {
      orgId: ctx.orgId,
      actorId: ctx.actor.principalId,
      targetType: 'task',
    };
    try {
      return await db.transaction(async (tx) => {
        const r = await fn(tx);
        await deps.audit.append(tx, {
          ...base,
          action,
          targetId: r.targetId ?? ctx.rootTaskId,
          data: { runId: ctx.runId, ...r.data },
        });
        return r.value;
      });
    } catch (err) {
      if (err instanceof AppError)
        await db
          .transaction((tx) =>
            deps.audit.append(tx, {
              ...base,
              action: 'delegation.denied',
              targetId: ctx.rootTaskId,
              data: { runId: ctx.runId, attempted: action, code: err.code, reason: err.message },
            }),
          )
          .catch(() => undefined);
      throw err;
    }
  }

  function requireDelegation(ctx: RunContext): void {
    if (ctx.policy.canDelegate !== true) throw forbidden('delegation is not allowed by policy');
    if (ctx.task.depth + 1 > MAX_DEPTH) throw conflict('max_depth', 'Subtasks cannot delegate further');
  }

  function requireLeader(ctx: RunContext): void {
    if (ctx.task.id !== ctx.rootTaskId) throw forbidden('only the goal leader may call this');
  }

  async function activeGoal(tx: Tx, ctx: RunContext): Promise<GoalState> {
    const goal = await deps.tasks.lockGoalState(tx, ctx.orgId, ctx.rootTaskId);
    if (!goal) throw conflict('no_goal', 'This run does not belong to a goal');
    if (goal.status !== 'planning' && goal.status !== 'continuing')
      throw conflict('goal_not_active', `Goal is ${goal.status}`);
    return goal;
  }

  async function candidates(db: Db | Tx, ctx: RunContext, target: TaskTarget): Promise<AgentDto[]> {
    if ('agentId' in target) {
      try {
        return [await deps.agents.getAgent(db, ctx.actor, target.agentId)];
      } catch (err) {
        if (err instanceof AppError && err.status === 404) return [];
        throw err;
      }
    }
    if ('label' in target) return deps.agents.listAgents(db, ctx.actor, { label: target.label });
    return deps.agents.listAgents(db, ctx.actor, { groupId: target.agentGroupId });
  }

  /** Every agent the target can resolve to must be in scope, since any of them may run the task. */
  async function checkTarget(
    db: Db | Tx,
    ctx: RunContext,
    target: TaskTarget,
    roles: readonly AgentDto['role'][],
  ): Promise<void> {
    const found = await candidates(db, ctx, target);
    if (found.length === 0) throw notFound('delegate target');
    for (const a of found) {
      if (a.id === ctx.leaderAgentId || !roles.includes(a.role))
        throw forbidden(`agent ${a.handle} (${a.role}) cannot receive this task`);
      if (!agentAllowed(ctx.policy.delegateTargets, a))
        throw forbidden(`agent ${a.handle} is outside the allowed delegation targets`);
    }
  }

  async function view(ctx: RunContext, tree: Task[], only: Task[], db: Db | Tx): Promise<SubtaskView[]> {
    const keys = new Map(tree.map((t) => [t.id, t.key]));
    const tokens = await deps.runs.tokensByTask(
      db,
      ctx.actor,
      only.map((t) => t.id),
    );
    return only.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      kind: t.kind,
      status: t.status,
      target: t.target,
      workDir: t.workDir,
      mode: t.mode,
      dependsOn: t.dependsOn.map((d) => keys.get(d) ?? d),
      result: t.result,
      error: t.error,
      tokens: tokens[t.id] ?? 0,
    }));
  }

  async function treeBudgetLeft(tx: Tx, ctx: RunContext, goal: GoalState, tree: Task[]): Promise<void> {
    const budget = effectiveLimit(goal.limits.treeTokenBudget, ctx.policy.treeTokenBudget);
    if (budget === undefined) return;
    const used = Object.values(
      await deps.runs.tokensByTask(
        tx,
        ctx.actor,
        tree.map((t) => t.id),
      ),
    ).reduce((a, b) => a + b, 0);
    if (used >= budget)
      throw conflict('tree_budget_exhausted', `Tree token budget exhausted (${used} of ${budget})`);
  }

  async function addChild(
    tx: Tx,
    ctx: RunContext,
    goal: GoalState,
    tree: Task[],
    input: {
      title: string;
      prompt: string;
      workDir: string;
      target: TaskTarget;
      priority?: number | undefined;
      mode: Mode;
      kind: 'task' | 'review';
      dependsOn: string[];
    },
  ): Promise<Task> {
    const root = tree.find((t) => t.id === ctx.rootTaskId);
    if (!root) throw notFound('goal task');
    // Subtasks of a project goal get their own worktrees instead of folders inside the goal's.
    if (!root.projectId && !isPathWithin(input.workDir, root.workDir))
      throw forbidden(`workDir ${input.workDir} is outside the goal workDir ${root.workDir}`);
    const limit = effectiveLimit(goal.limits.maxSubtasks, ctx.policy.maxSubtasks);
    const existing = tree.filter((t) => t.id !== root.id).length;
    if (limit !== undefined && existing >= limit)
      throw conflict('max_subtasks', `Subtask limit reached (${limit})`);
    await treeBudgetLeft(tx, ctx, goal, tree);
    const { kind, dependsOn, ...rest } = input;
    return deps.tasks.createChildTask(tx, ctx.actor, rest, {
      kind,
      rootTaskId: root.id,
      parentTaskId: root.id,
      depth: ctx.task.depth + 1,
      dependsOn,
      ...(goal.approval === 'required' && { proposed: true }),
      ...(root.projectId && kind === 'task' && { projectId: root.projectId }),
    });
  }

  function resolveDependencies(tree: Task[], ctx: RunContext, refs: string[]): string[] {
    const ids = new Set<string>();
    for (const ref of refs) {
      const dep = tree.find((t) => (t.key === ref || t.id === ref) && t.id !== ctx.rootTaskId);
      if (!dep) throw invalid([{ path: 'dependsOn', message: `${ref} is not a subtask of this goal` }]);
      ids.add(dep.id);
    }
    return [...ids];
  }

  return {
    /** Authenticates a leader's call by its run token and loads the run, task and effective policy. */
    async resolveRunContext(db: Db, runId: string, token: string): Promise<RunContext> {
      const auth = await deps.verifyRunToken(db, runId, token);
      if (!auth) throw unauthorized();
      const actor: ActorContext = {
        orgId: auth.orgId,
        principalId: auth.agentId,
        kind: 'agent',
        requestId: randomUUID(),
      };
      const run = await deps.runs.getRun(db, actor, runId);
      if (run.status !== 'running') throw conflict('run_not_running', 'Run is not running');
      const task = await deps.tasks.getTask(db, actor, run.taskId);
      const policy = run.effectivePolicy as unknown as EffectivePolicy & { mode?: Mode; plannedMode?: Mode };
      return {
        orgId: auth.orgId,
        runId,
        taskId: task.id,
        rootTaskId: task.rootTaskId ?? task.id,
        task,
        leaderAgentId: run.agentId,
        actor,
        policy,
        mode: policy.mode ?? policy.maxMode,
        delegationMode: policy.plannedMode ?? policy.mode ?? policy.maxMode,
      };
    },

    async listDelegateAgents(
      db: Db,
      ctx: RunContext,
      filter: DelegateAgentFilter = {},
    ): Promise<DelegateAgentView[]> {
      const f = parse(DelegateAgentFilter, filter);
      return audited(db, ctx, 'delegation.list_agents', async (tx) => {
        requireDelegation(ctx);
        const all = await deps.agents.listAgents(tx, ctx.actor, f.label ? { label: f.label } : {});
        const agents = all.filter(
          (a) =>
            a.role !== 'leader' &&
            a.id !== ctx.leaderAgentId &&
            (!f.role || a.role === f.role) &&
            agentAllowed(ctx.policy.delegateTargets, a),
        );
        return { value: agents.map(toAgentView), data: { count: agents.length } };
      });
    },

    async createSubtask(db: Db, ctx: RunContext, input: CreateSubtaskInput): Promise<SubtaskView> {
      const v = parse(CreateSubtaskInput, input);
      return audited(db, ctx, 'delegation.create_subtask', async (outer) => {
        requireDelegation(ctx);
        await checkTarget(outer, ctx, v.target, ['worker', 'reviewer']);
        const goal = await activeGoal(outer, ctx);
        const tree = await deps.tasks.listTree(outer, ctx.orgId, ctx.rootTaskId);
        const mode = capSubtaskMode(v.mode, ctx.delegationMode, ctx.policy.maxMode);
        const task = await addChild(outer, ctx, goal, tree, {
          title: v.title,
          prompt: v.prompt,
          workDir: v.workDir ?? ctx.task.workDir,
          target: v.target,
          ...(v.priority !== undefined && { priority: v.priority }),
          mode,
          kind: 'task',
          dependsOn: resolveDependencies(tree, ctx, v.dependsOn ?? []),
        });
        const [created] = await view(ctx, [...tree, task], [task], outer);
        if (!created) throw new Error('Missing created subtask');
        return {
          value: created,
          targetId: task.id,
          data: { key: task.key, target: v.target, mode, requestedMode: v.mode ?? null },
        };
      });
    },

    async listSubtasks(db: Db, ctx: RunContext): Promise<SubtaskView[]> {
      return audited(db, ctx, 'delegation.list_subtasks', async (tx) => {
        requireLeader(ctx);
        const tree = await deps.tasks.listTree(tx, ctx.orgId, ctx.rootTaskId);
        const subtasks = tree.filter((t) => t.id !== ctx.rootTaskId);
        return { value: await view(ctx, tree, subtasks, tx), data: { count: subtasks.length } };
      });
    },

    async getTask(db: Db, ctx: RunContext, key: string): Promise<SubtaskView> {
      return audited(db, ctx, 'delegation.get_task', async (tx) => {
        requireLeader(ctx);
        const tree = await deps.tasks.listTree(tx, ctx.orgId, ctx.rootTaskId);
        const task = tree.find((t) => t.key === key);
        if (!task) throw notFound('task');
        const [one] = await view(ctx, tree, [task], tx);
        if (!one) throw new Error('Missing task view');
        return { value: one, targetId: task.id, data: { key } };
      });
    },

    async requestReview(db: Db, ctx: RunContext, input: RequestReviewInput): Promise<SubtaskView> {
      const v = parse(RequestReviewInput, input);
      return audited(db, ctx, 'delegation.request_review', async (outer) => {
        requireDelegation(ctx);
        await checkTarget(outer, ctx, v.reviewerTarget, ['reviewer']);
        const goal = await activeGoal(outer, ctx);
        const tree = await deps.tasks.listTree(outer, ctx.orgId, ctx.rootTaskId);
        const subject = tree.find((t) => t.key === v.subtaskKey && t.id !== ctx.rootTaskId);
        if (!subject) throw notFound(`subtask ${v.subtaskKey}`);
        if (subject.status !== 'done')
          throw conflict('subtask_not_done', `Subtask ${subject.key} is ${subject.status}, not done`);
        const prompt = [
          `Review the result of ${subject.key} "${subject.title}".`,
          '',
          `Instructions: ${v.instructions}`,
          '',
          `Original task: ${subject.prompt}`,
          '',
          `Result summary: ${subject.result?.summary ?? '(none)'}`,
        ].join('\n');
        const task = await addChild(outer, ctx, goal, tree, {
          title: `Review: ${subject.title}`.slice(0, 200),
          prompt,
          workDir: subject.workDir,
          target: v.reviewerTarget,
          mode: 'read-only',
          kind: 'review',
          dependsOn: [subject.id],
        });
        const [created] = await view(ctx, [...tree, task], [task], outer);
        if (!created) throw new Error('Missing created review');
        return { value: created, targetId: task.id, data: { key: task.key, subject: subject.key } };
      });
    },

    async completeGoal(
      db: Db,
      ctx: RunContext,
      input: CompleteGoalInput,
    ): Promise<{ status: GoalState['status']; cancelledSubtasks: string[] }> {
      const v = parse(CompleteGoalInput, input);
      return audited(db, ctx, 'delegation.complete_goal', async (tx) => {
        requireLeader(ctx);
        const goal = await activeGoal(tx, ctx);
        const status = v.outcome === 'failed' ? 'failed' : 'completed';
        const cancelled = await deps.tasks.cancelOpenTreeTasks(
          tx,
          ctx.actor,
          ctx.rootTaskId,
          'goal completed',
        );
        await deps.tasks.updateGoalState(tx, ctx.orgId, goal.rootTaskId, {
          status,
          summary: v.summary,
          outcome: v.outcome,
          ...(status === 'failed' && { reason: 'leader reported failure' }),
        });
        await deps.tasks.recordResult(tx, ctx.actor, ctx.rootTaskId, {
          summary: truncateBytes(v.summary, RESULT_SUMMARY_MAX_BYTES),
          outcome: v.outcome,
        });
        return {
          value: { status, cancelledSubtasks: cancelled.map((t) => t.key) },
          data: { outcome: v.outcome, cancelled: cancelled.length },
        };
      });
    },

    async postNote(db: Db, ctx: RunContext, text: string): Promise<void> {
      const note = text.trim();
      if (note.length === 0 || note.length > 2000)
        throw invalid([{ path: 'text', message: 'must be 1 to 2000 characters' }]);
      await audited(db, ctx, 'delegation.note', async (tx) => {
        requireLeader(ctx);
        await deps.tasks.addGoalNote(tx, ctx.orgId, ctx.rootTaskId, {
          at: new Date().toISOString(),
          runId: ctx.runId,
          text: note,
        });
        return { value: undefined, data: { length: note.length } };
      });
    },
  };
}

export type Delegation = ReturnType<typeof createDelegation>;
