import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import type { Tx } from '../../../platform/tx.ts';
import { conflict, forbidden, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import type { DbOrTx, ModuleDeps, OrgSettings } from '../../../ports/index.ts';
import { formatTaskKey } from '../domain/key.ts';
import {
  CreateTask,
  boardColumn,
  boardColumns,
  resource,
  type CreateTaskInput,
  type TaskStatus,
} from '../domain/task.ts';
import {
  resolveGoalLimits,
  terminalStatuses,
  type Eligibility,
  type GoalNote,
  type GoalStatus,
  type TaskKind,
  type TaskResult,
} from '../domain/goal.ts';
import { goalStates, tasks, taskKeySeq, type GoalState, type Task } from '../infra/schema.ts';
export interface TaskFilter {
  statuses?: TaskStatus[];
  accountTaskIds?: string[];
  accountAgentIds?: string[];
  pageCursor?: string;
  limit?: number;
  status?: TaskStatus;
  agentId?: string;
  label?: string;
  agentGroupId?: string;
  text?: string;
  scheduleId?: string;
}
/** Tree placement of a subtask; only the delegation module supplies it, after its own checks. */
export interface ChildPlacement {
  kind: Exclude<TaskKind, 'goal'>;
  rootTaskId: string;
  parentTaskId: string;
  depth: number;
  dependsOn: string[];
}

export type TasksDeps = ModuleDeps & { orgSettings: OrgSettings; now?: () => Date };
export function createTasks(deps: TasksDeps) {
  const where = (actor: ActorContext, id: string) => and(eq(tasks.orgId, actor.orgId), eq(tasks.id, id));
  async function get(tx: Tx, actor: ActorContext, id: string) {
    const [task] = await tx.select().from(tasks).where(where(actor, id)).for('update');
    if (!task) throw notFound('task');
    return task;
  }
  async function audit(tx: Tx, actor: ActorContext, action: string, task: Task) {
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action,
      targetType: 'task',
      targetId: task.id,
    });
  }
  async function changed(tx: Tx, actor: ActorContext, task: Task, action: string) {
    await audit(tx, actor, action, task);
    await publish(tx, 'task.updated', { orgId: actor.orgId, taskId: task.id });
    return task;
  }
  function system(actor: ActorContext) {
    if (actor.kind !== 'system') throw forbidden('System actor required');
  }
  async function update(
    tx: Tx,
    actor: ActorContext,
    id: string,
    values: Partial<typeof tasks.$inferInsert>,
    action: string,
  ) {
    const [task] = await tx
      .update(tasks)
      .set({ ...values, updatedAt: new Date() })
      .where(where(actor, id))
      .returning();
    if (!task) throw notFound('task');
    return changed(tx, actor, task, action);
  }
  async function list(tx: Tx, actor: ActorContext, filter: TaskFilter) {
    await deps.authorizer.authorize(
      tx,
      actor,
      'read',
      filter.agentId
        ? { agentId: filter.agentId }
        : filter.agentGroupId
          ? { agentGroupIds: [filter.agentGroupId] }
          : {},
    );
    const after = filter.pageCursor
      ? (JSON.parse(filter.pageCursor) as { at: string; id: string })
      : undefined;
    const paged = filter.limit !== undefined;
    const result = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.orgId, actor.orgId),
          filter.statuses ? inArray(tasks.status, filter.statuses) : undefined,
          filter.accountTaskIds
            ? sql`(${inArray(tasks.id, filter.accountTaskIds)} or ${inArray(sql`${tasks.target}->>'agentId'`, filter.accountAgentIds ?? [])})`
            : undefined,
          after
            ? sql`(date_trunc('milliseconds', ${tasks.createdAt}), ${tasks.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
            : undefined,
          filter.status ? eq(tasks.status, filter.status) : undefined,
          filter.agentId ? sql`${tasks.target}->>'agentId' = ${filter.agentId}` : undefined,
          filter.label ? sql`${tasks.target}->>'label' = ${filter.label}` : undefined,
          filter.agentGroupId ? sql`${tasks.target}->>'agentGroupId' = ${filter.agentGroupId}` : undefined,
          filter.scheduleId ? eq(tasks.scheduleId, filter.scheduleId) : undefined,
          filter.text
            ? ilike(sql`${tasks.key} || ' ' || ${tasks.title}`, `%${filter.text.replace(/[\\%_]/g, '\\$&')}%`)
            : undefined,
        ),
      )
      .orderBy(
        ...(paged
          ? [desc(sql`date_trunc('milliseconds', ${tasks.createdAt})`), desc(tasks.id)]
          : [asc(tasks.priority), asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id)]),
      )
      .limit(filter.limit ?? 2147483647);
    return result;
  }
  async function createIn(
    tx: Tx,
    actor: ActorContext,
    input: CreateTaskInput,
    child?: ChildPlacement,
  ): Promise<Task> {
    const parsed = CreateTask.safeParse(input);
    if (!parsed.success) throw invalid(parsed.error.issues);
    const { runAt, goalLimits, ...rest } = parsed.data;
    if (goalLimits && rest.kind !== 'goal')
      throw invalid([{ path: 'goalLimits', message: 'only allowed for goals' }]);
    if (runAt && runAt.getTime() <= (deps.now?.() ?? new Date()).getTime())
      throw invalid([{ path: 'runAt', message: 'must be in the future' }]);
    if (!child) await deps.authorizer.authorize(tx, actor, 'task.write', resource(parsed.data.target));
    const settings = await deps.orgSettings.get(tx, actor.orgId);
    await tx.insert(taskKeySeq).values({ orgId: actor.orgId }).onConflictDoNothing();
    const [counter] = await tx
      .update(taskKeySeq)
      .set({ seq: sql`${taskKeySeq.seq}+1` })
      .where(eq(taskKeySeq.orgId, actor.orgId))
      .returning();
    if (!counter) throw new Error('Missing task counter');
    const id = randomUUID();
    const [task] = await tx
      .insert(tasks)
      .values({
        ...rest,
        ...(child ?? {}),
        id,
        ...(rest.kind === 'goal' ? { rootTaskId: id } : {}),
        ...(runAt ? { runAt, status: 'scheduled' as const } : {}),
        orgId: actor.orgId,
        key: formatTaskKey(settings.taskKeyPrefix, counter.seq),
        createdBy: actor.principalId,
      })
      .returning();
    if (!task) throw new Error('Missing inserted task');
    if (task.kind === 'goal')
      await tx.insert(goalStates).values({
        rootTaskId: task.id,
        orgId: actor.orgId,
        limits: resolveGoalLimits(goalLimits),
        goalPrompt: task.prompt,
      });
    return changed(tx, actor, task, child ? 'task.create_subtask' : 'task.create');
  }

  const openStatuses = ['scheduled', 'queued', 'claimed', 'running', 'rate_limited'] as const;
  const isOpen = (status: Task['status']): boolean => (openStatuses as readonly string[]).includes(status);

  async function treeOf(db: DbOrTx, orgId: string, rootTaskId: string): Promise<Task[]> {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.rootTaskId, rootTaskId)))
      .orderBy(asc(tasks.createdAt), asc(tasks.key), asc(tasks.id));
  }

  async function getGoal(db: DbOrTx, orgId: string, rootTaskId: string): Promise<GoalState | undefined> {
    const [goal] = await db
      .select()
      .from(goalStates)
      .where(and(eq(goalStates.orgId, orgId), eq(goalStates.rootTaskId, rootTaskId)));
    return goal;
  }

  async function lockGoal(tx: Tx, orgId: string, rootTaskId: string): Promise<GoalState | undefined> {
    const [goal] = await tx
      .select()
      .from(goalStates)
      .where(and(eq(goalStates.orgId, orgId), eq(goalStates.rootTaskId, rootTaskId)))
      .for('update');
    return goal;
  }

  async function patchGoal(
    tx: Tx,
    orgId: string,
    rootTaskId: string,
    patch: Partial<typeof goalStates.$inferInsert>,
  ): Promise<GoalState> {
    const [goal] = await tx
      .update(goalStates)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(goalStates.orgId, orgId), eq(goalStates.rootTaskId, rootTaskId)))
      .returning();
    if (!goal) throw notFound('goal');
    await publish(tx, 'task.updated', { orgId, taskId: rootTaskId });
    return goal;
  }

  async function cancelOpen(
    tx: Tx,
    actor: ActorContext,
    rootTaskId: string,
    reason: string,
    opts: { includeRoot?: boolean; only?: (t: Task) => boolean } = {},
  ): Promise<Task[]> {
    const open = (await treeOf(tx, actor.orgId, rootTaskId)).filter(
      (t) => isOpen(t.status) && (opts.includeRoot || t.id !== rootTaskId) && (opts.only?.(t) ?? true),
    );
    const cancelled: Task[] = [];
    for (const t of open) {
      const wasActive = t.status === 'claimed' || t.status === 'running';
      cancelled.push(
        await update(
          tx,
          actor,
          t.id,
          { status: 'cancelled', runAt: null, resumeAt: null, error: reason },
          'task.cancel',
        ),
      );
      if (wasActive)
        await publish(tx, 'task.cancel_requested', {
          orgId: actor.orgId,
          taskId: t.id,
          previousStatus: t.status,
        });
    }
    return cancelled;
  }
  return {
    createTask(db: Db, actor: ActorContext, input: CreateTaskInput): Promise<Task> {
      return db.transaction((tx) => createIn(tx, actor, input));
    },
    createTaskIn: (tx: Tx, actor: ActorContext, input: CreateTaskInput) => createIn(tx, actor, input),
    /** Creates a subtask inside a goal tree. Callers (the delegation module) enforce the rules first. */
    createChildTask: (tx: Tx, actor: ActorContext, input: CreateTaskInput, placement: ChildPlacement) =>
      createIn(tx, actor, input, placement),
    getGoalState: getGoal,
    lockGoalState: lockGoal,
    updateGoalState: patchGoal,
    async listGoalStates(db: DbOrTx, orgId: string, statuses?: GoalStatus[]): Promise<GoalState[]> {
      return db
        .select()
        .from(goalStates)
        .where(and(eq(goalStates.orgId, orgId), statuses ? inArray(goalStates.status, statuses) : undefined))
        .orderBy(asc(goalStates.createdAt), asc(goalStates.rootTaskId));
    },
    async listGoals(db: Db, actor: ActorContext): Promise<{ goal: GoalState; task: Task }[]> {
      await deps.authorizer.authorize(db, actor, 'read', {});
      const rows = await db
        .select()
        .from(goalStates)
        .innerJoin(tasks, eq(tasks.id, goalStates.rootTaskId))
        .where(eq(goalStates.orgId, actor.orgId))
        .orderBy(asc(goalStates.createdAt), asc(goalStates.rootTaskId));
      return rows.map((r) => ({ goal: r.goal_states, task: r.tasks }));
    },
    listTree: treeOf,
    async getTaskTree(db: Db, actor: ActorContext, id: string): Promise<{ goal: GoalState; tasks: Task[] }> {
      const [task] = await db.select().from(tasks).where(where(actor, id));
      if (!task) throw notFound('task');
      const rootId = task.rootTaskId ?? task.id;
      const [root] = await db.select().from(tasks).where(where(actor, rootId));
      if (!root) throw notFound('task');
      await deps.authorizer.authorize(db, actor, 'read', resource(root.target));
      const goal = await getGoal(db, actor.orgId, rootId);
      if (!goal) throw notFound('goal');
      return { goal, tasks: await treeOf(db, actor.orgId, rootId) };
    },
    async recordResult(tx: Tx, actor: ActorContext, id: string, result: TaskResult): Promise<Task> {
      const [task] = await tx
        .update(tasks)
        .set({ result, updatedAt: new Date() })
        .where(where(actor, id))
        .returning();
      if (!task) throw notFound('task');
      return changed(tx, actor, task, 'task.result');
    },
    cancelOpenTreeTasks: cancelOpen,
    /** Cancels queued tasks whose dependencies ended without success; they could never be claimed. */
    async cancelUnrunnable(tx: Tx, actor: ActorContext, rootTaskId: string): Promise<Task[]> {
      system(actor);
      const tree = await treeOf(tx, actor.orgId, rootTaskId);
      const byId = new Map(tree.map((t) => [t.id, t]));
      const broken = (t: Task): Task | undefined =>
        t.dependsOn
          .map((d) => byId.get(d))
          .find(
            (d) => d && (terminalStatuses as readonly string[]).includes(d.status) && d.status !== 'done',
          );
      const cancelled: Task[] = [];
      for (const t of tree.filter((x) => x.status === 'queued' || x.status === 'scheduled')) {
        const dep = broken(t);
        if (dep)
          cancelled.push(
            await update(
              tx,
              actor,
              t.id,
              { status: 'cancelled', runAt: null, error: `dependency ${dep.key} ${dep.status}` },
              'task.cancel',
            ),
          );
      }
      return cancelled;
    },
    /** Puts a finished goal task back in the queue for its next leader turn. */
    async requeueGoalTask(tx: Tx, actor: ActorContext, id: string, prompt: string): Promise<Task> {
      system(actor);
      return update(
        tx,
        actor,
        id,
        { status: 'queued', prompt, attempt: 1, workerId: null, error: null, resumeAt: null, runAt: null },
        'task.continue',
      );
    },
    /** Forces the goal task into a terminal status when the goal ends outside a leader run. */
    async finishGoalTask(
      tx: Tx,
      actor: ActorContext,
      id: string,
      status: 'failed' | 'cancelled',
      error: string,
    ): Promise<Task> {
      system(actor);
      return update(tx, actor, id, { status, error, resumeAt: null, runAt: null }, 'task.goal_finish');
    },
    /** Called by the worker when a leader run ends; moves the goal to waiting unless it was completed. */
    async endGoalTurn(
      tx: Tx,
      actor: ActorContext,
      rootTaskId: string,
      turn: { agentId: string; sessionId?: string; failure?: string },
    ): Promise<GoalState | undefined> {
      system(actor);
      const goal = await lockGoal(tx, actor.orgId, rootTaskId);
      if (!goal || (goal.status !== 'planning' && goal.status !== 'continuing')) return goal;
      return patchGoal(tx, actor.orgId, rootTaskId, {
        leaderAgentId: turn.agentId,
        leaderSessionId: turn.sessionId ?? goal.leaderSessionId,
        ...(turn.failure
          ? { status: 'failed' as const, reason: `leader run failed: ${turn.failure}` }
          : { status: 'waiting' as const }),
      });
    },
    async addGoalNote(tx: Tx, orgId: string, rootTaskId: string, note: GoalNote): Promise<GoalState> {
      const goal = await lockGoal(tx, orgId, rootTaskId);
      if (!goal) throw notFound('goal');
      return patchGoal(tx, orgId, rootTaskId, { notes: [...goal.notes, note].slice(-200) });
    },
    async hasOpenTaskOfSchedule(tx: Tx, actor: ActorContext, scheduleId: string): Promise<boolean> {
      await deps.authorizer.authorize(tx, actor, 'read', {});
      const [row] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, actor.orgId),
            eq(tasks.scheduleId, scheduleId),
            notInArray(tasks.status, ['done', 'failed', 'cancelled', 'denied']),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    async releaseDueScheduled(tx: Tx, actor: ActorContext, now: Date): Promise<Task[]> {
      system(actor);
      await deps.authorizer.authorize(tx, actor, 'task.write', {});
      const due = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.status, 'scheduled'), lte(tasks.runAt, now)))
        .orderBy(asc(tasks.runAt), asc(tasks.id))
        .for('update', { skipLocked: true });
      const released: Task[] = [];
      for (const task of due)
        released.push(
          await update(tx, actor, task.id, { status: 'queued', runAt: null }, 'task.release_scheduled'),
        );
      return released;
    },
    async resumeDueRateLimited(
      tx: Tx,
      actor: ActorContext,
      now: Date,
    ): Promise<{ resumed: Task[]; exhausted: Task[] }> {
      system(actor);
      await deps.authorizer.authorize(tx, actor, 'task.write', {});
      const due = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, actor.orgId),
            eq(tasks.status, 'rate_limited'),
            isNotNull(tasks.resumeAt),
            lte(tasks.resumeAt, now),
          ),
        )
        .orderBy(asc(tasks.resumeAt), asc(tasks.id))
        .for('update', { skipLocked: true });
      const resumed: Task[] = [];
      const exhausted: Task[] = [];
      for (const task of due) {
        if (task.attempt < task.maxAttempts)
          resumed.push(
            await update(
              tx,
              actor,
              task.id,
              { status: 'queued', attempt: task.attempt + 1, resumeAt: null, workerId: null, error: null },
              'task.resume',
            ),
          );
        else
          exhausted.push(
            await update(
              tx,
              actor,
              task.id,
              { status: 'failed', resumeAt: null, error: 'rate limit retries exhausted' },
              'task.resume_exhausted',
            ),
          );
      }
      return { resumed, exhausted };
    },
    async cancelTask(db: Db, actor: ActorContext, id: string): Promise<Task> {
      return db.transaction(async (tx) => {
        const task = await get(tx, actor, id);
        await deps.authorizer.authorize(tx, actor, 'task.write', resource(task.target));
        if (!['scheduled', 'queued', 'claimed', 'running', 'rate_limited'].includes(task.status))
          throw conflict('task_terminal', 'Task is already terminal');
        const wasActive = task.status === 'claimed' || task.status === 'running';
        const cancelled = await update(
          tx,
          actor,
          id,
          { status: 'cancelled', runAt: null, resumeAt: null },
          'task.cancel',
        );
        if (wasActive)
          await publish(tx, 'task.cancel_requested', {
            orgId: actor.orgId,
            taskId: id,
            previousStatus: task.status,
          });
        if (task.kind === 'goal') {
          const goal = await lockGoal(tx, actor.orgId, task.id);
          if (goal && goal.status !== 'completed' && goal.status !== 'failed')
            await patchGoal(tx, actor.orgId, task.id, { status: 'failed', reason: 'cancelled by user' });
          await cancelOpen(tx, actor, task.id, 'goal cancelled');
        }
        return cancelled;
      });
    },
    async getTask(db: Db, actor: ActorContext, id: string): Promise<Task> {
      const [task] = await db.select().from(tasks).where(where(actor, id));
      if (!task) throw notFound('task');
      await deps.authorizer.authorize(db, actor, 'read', resource(task.target));
      return task;
    },
    async setTaskPriority(db: Db, actor: ActorContext, id: string, priority: number): Promise<Task> {
      if (!Number.isInteger(priority) || priority < 0 || priority > 3)
        throw invalid([{ path: 'priority', message: 'must be an integer from 0 to 3' }]);
      return db.transaction(async (tx) => {
        const task = await get(tx, actor, id);
        await deps.authorizer.authorize(tx, actor, 'task.write', resource(task.target));
        if (task.status !== 'queued')
          throw conflict('task_not_queued', 'Only queued tasks can change priority');
        return update(tx, actor, id, { priority }, 'task.priority');
      });
    },
    listTasks(db: Db, actor: ActorContext, filter: TaskFilter = {}): Promise<Task[]> {
      return db.transaction((tx) => list(tx, actor, filter));
    },
    async boardView(
      db: Db,
      actor: ActorContext,
      filter: TaskFilter = {},
    ): Promise<Record<(typeof boardColumns)[number], Task[]>> {
      const result = await db.transaction((tx) => list(tx, actor, filter));
      const columns: Record<(typeof boardColumns)[number], Task[]> = {
        scheduled: [],
        queued: [],
        running: [],
        rate_limited: [],
        done: [],
        failed: [],
        cancelled: [],
      };
      for (const task of result) columns[boardColumn(task.status)].push(task);
      return columns;
    },
    async reorderTask(db: Db, actor: ActorContext, id: string, beforeId?: string): Promise<Task> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`task-reorder:${actor.orgId}`}))`);
        const task = await get(tx, actor, id);
        await deps.authorizer.authorize(tx, actor, 'task.write', resource(task.target));
        if (task.status !== 'queued') throw conflict('task_not_queued', 'Only queued tasks can be reordered');
        if (beforeId === id) {
          await audit(tx, actor, 'task.reorder', task);
          return task;
        }
        const peers = await tx
          .select()
          .from(tasks)
          .where(
            and(eq(tasks.orgId, actor.orgId), eq(tasks.status, 'queued'), eq(tasks.priority, task.priority)),
          )
          .orderBy(asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id))
          .for('update');
        const ordered = peers.filter((t) => t.id !== id);
        const position = beforeId ? ordered.findIndex((t) => t.id === beforeId) : ordered.length;
        if (position < 0)
          throw conflict('invalid_reorder_target', 'Target must be queued at the same priority');
        ordered.splice(position, 0, task);
        // Renumbering avoids ties and floating point midpoint exhaustion.
        for (const [i, peer] of ordered.entries())
          if (peer.rank !== i) await update(tx, actor, peer.id, { rank: i }, 'task.reorder');
        return get(tx, actor, id);
      });
    },
    async claimNextTask(
      tx: Tx,
      actor: ActorContext,
      workerId: string,
      opts: { excludeTaskIds?: string[] } = {},
    ): Promise<Task | null> {
      system(actor);
      await deps.authorizer.authorize(tx, actor, 'task.write', {});
      const [task] = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, actor.orgId),
            eq(tasks.status, 'queued'),
            sql`(${tasks.eligibility} is null or (${tasks.eligibility}->>'nextCheckAt')::timestamptz <= ${(deps.now?.() ?? new Date()).toISOString()}::timestamptz)`,
            sql`not exists (select 1 from unnest(${tasks.dependsOn}) as dep(id) where not exists (select 1 from tasks dt where dt.id = dep.id and dt.status = 'done'))`,
            opts.excludeTaskIds?.length ? notInArray(tasks.id, opts.excludeTaskIds) : undefined,
          ),
        )
        .orderBy(asc(tasks.priority), asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!task) return null;
      // Claiming is silent: the worker audits it once it starts a run (recordClaim), so tasks that
      // keep going back to the queue do not flood the audit log.
      const [claimed] = await tx
        .update(tasks)
        .set({ status: 'claimed', workerId, updatedAt: new Date() })
        .where(where(actor, task.id))
        .returning();
      return claimed ?? null;
    },
    async recordClaim(tx: Tx, actor: ActorContext, task: Task): Promise<void> {
      system(actor);
      await audit(tx, actor, 'task.claim', task);
    },
    /**
     * Returns a claimed task to the queue because no agent can take it now. Records the reason, schedules
     * the next check with exponential backoff and audits only when the reason changes.
     */
    async markIneligible(
      tx: Tx,
      actor: ActorContext,
      id: string,
      reason: string,
      opts: { baseMs: number; maxMs: number; retryAt?: Date },
    ): Promise<Task> {
      system(actor);
      const task = await get(tx, actor, id);
      if (task.status !== 'claimed') throw conflict('task_not_claimed', 'Only claimed tasks can be released');
      const now = deps.now?.() ?? new Date();
      const prev = task.eligibility;
      const same = prev?.reason === reason;
      const checks = prev && same ? prev.checks + 1 : 0;
      let next = now.getTime() + Math.min(opts.baseMs * 2 ** checks, opts.maxMs);
      if (opts.retryAt && opts.retryAt.getTime() > now.getTime())
        next = Math.min(next, opts.retryAt.getTime());
      const eligibility: Eligibility = {
        reason,
        checkedAt: now.toISOString(),
        nextCheckAt: new Date(next).toISOString(),
        checks,
      };
      const values = {
        status: 'queued' as const,
        workerId: null,
        error: `no eligible agent: ${reason}`,
        eligibility,
        updatedAt: new Date(),
      };
      if (!same) return update(tx, actor, id, values, 'task.ineligible');
      const [updated] = await tx.update(tasks).set(values).where(where(actor, id)).returning();
      if (!updated) throw notFound('task');
      return updated;
    },
    /** Makes every waiting task eligible for an immediate re-check after relevant state changed. */
    async clearEligibility(tx: Tx, actor: ActorContext): Promise<number> {
      system(actor);
      const rows = await tx
        .update(tasks)
        .set({ eligibility: null })
        .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.status, 'queued'), isNotNull(tasks.eligibility)))
        .returning({ id: tasks.id });
      if (rows.length > 0) await publish(tx, 'task.updated', { orgId: actor.orgId });
      return rows.length;
    },
    async releaseTask(tx: Tx, actor: ActorContext, id: string, reason?: string): Promise<Task> {
      system(actor);
      const task = await get(tx, actor, id);
      await deps.authorizer.authorize(tx, actor, 'task.write', resource(task.target));
      if (task.status !== 'claimed') throw conflict('task_not_claimed', 'Only claimed tasks can be released');
      return update(
        tx,
        actor,
        id,
        { status: 'queued', workerId: null, error: reason ?? null },
        'task.release',
      );
    },
    async setTaskStatus(
      tx: Tx,
      actor: ActorContext,
      id: string,
      status: TaskStatus,
      error?: string,
      opts: { resumeAt?: Date } = {},
    ): Promise<Task> {
      system(actor);
      const task = await get(tx, actor, id);
      await deps.authorizer.authorize(tx, actor, 'task.write', resource(task.target));
      const transitions: Partial<Record<TaskStatus, TaskStatus[]>> = {
        queued: ['denied', 'cancelled'],
        claimed: ['running', 'denied', 'failed', 'cancelled'],
        running: ['done', 'failed', 'rate_limited', 'cancelled'],
      };
      if (!transitions[task.status]?.includes(status))
        throw conflict('invalid_task_transition', `${task.status} cannot become ${status}`);
      return update(
        tx,
        actor,
        id,
        {
          status,
          error: error ?? null,
          eligibility: null,
          ...(status === 'rate_limited' ? { resumeAt: opts.resumeAt ?? null } : {}),
        },
        'task.status',
      );
    },
  };
}
