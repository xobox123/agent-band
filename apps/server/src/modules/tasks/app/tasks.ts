import { and, asc, eq, ilike, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import type { Tx } from '../../../platform/tx.ts';
import { conflict, forbidden, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import type { ModuleDeps, OrgSettings } from '../../../ports/index.ts';
import { formatTaskKey } from '../domain/key.ts';
import {
  CreateTask,
  boardColumn,
  boardColumns,
  resource,
  type CreateTaskInput,
  type TaskStatus,
} from '../domain/task.ts';
import { tasks, taskKeySeq, type Task } from '../infra/schema.ts';
export interface TaskFilter {
  status?: TaskStatus;
  agentId?: string;
  label?: string;
  agentGroupId?: string;
  text?: string;
  scheduleId?: string;
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
    const result = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.orgId, actor.orgId),
          filter.status ? eq(tasks.status, filter.status) : undefined,
          filter.agentId ? sql`${tasks.target}->>'agentId' = ${filter.agentId}` : undefined,
          filter.label ? sql`${tasks.target}->>'label' = ${filter.label}` : undefined,
          filter.agentGroupId ? sql`${tasks.target}->>'agentGroupId' = ${filter.agentGroupId}` : undefined,
          filter.scheduleId ? eq(tasks.scheduleId, filter.scheduleId) : undefined,
          filter.text ? ilike(sql`${tasks.key} || ' ' || ${tasks.title}`, `%${filter.text}%`) : undefined,
        ),
      )
      .orderBy(asc(tasks.priority), asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id));
    return result;
  }
  async function createIn(tx: Tx, actor: ActorContext, input: CreateTaskInput): Promise<Task> {
    const parsed = CreateTask.safeParse(input);
    if (!parsed.success) throw invalid(parsed.error.issues);
    const { runAt, ...rest } = parsed.data;
    if (runAt && runAt.getTime() <= (deps.now?.() ?? new Date()).getTime())
      throw invalid([{ path: 'runAt', message: 'must be in the future' }]);
    await deps.authorizer.authorize(tx, actor, 'task.write', resource(parsed.data.target));
    const settings = await deps.orgSettings.get(tx, actor.orgId);
    await tx.insert(taskKeySeq).values({ orgId: actor.orgId }).onConflictDoNothing();
    const [counter] = await tx
      .update(taskKeySeq)
      .set({ seq: sql`${taskKeySeq.seq}+1` })
      .where(eq(taskKeySeq.orgId, actor.orgId))
      .returning();
    if (!counter) throw new Error('Missing task counter');
    const [task] = await tx
      .insert(tasks)
      .values({
        ...rest,
        ...(runAt ? { runAt, status: 'scheduled' as const } : {}),
        orgId: actor.orgId,
        key: formatTaskKey(settings.taskKeyPrefix, counter.seq),
        createdBy: actor.principalId,
      })
      .returning();
    if (!task) throw new Error('Missing inserted task');
    return changed(tx, actor, task, 'task.create');
  }
  return {
    createTask(db: Db, actor: ActorContext, input: CreateTaskInput): Promise<Task> {
      return db.transaction((tx) => createIn(tx, actor, input));
    },
    createTaskIn: createIn,
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
            opts.excludeTaskIds?.length ? notInArray(tasks.id, opts.excludeTaskIds) : undefined,
          ),
        )
        .orderBy(asc(tasks.priority), asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id))
        .limit(1)
        .for('update', { skipLocked: true });
      return task ? update(tx, actor, task.id, { status: 'claimed', workerId }, 'task.claim') : null;
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
          ...(status === 'rate_limited' ? { resumeAt: opts.resumeAt ?? null } : {}),
        },
        'task.status',
      );
    },
  };
}
