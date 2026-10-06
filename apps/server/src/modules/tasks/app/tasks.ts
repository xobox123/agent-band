import { and, asc, eq, ilike, sql } from 'drizzle-orm';
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
}
export type TasksDeps = ModuleDeps & { orgSettings: OrgSettings };
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
          filter.text ? ilike(sql`${tasks.key} || ' ' || ${tasks.title}`, `%${filter.text}%`) : undefined,
        ),
      )
      .orderBy(asc(tasks.priority), asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id));
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'task.list',
      targetType: 'organization',
      targetId: actor.orgId,
    });
    return result;
  }
  return {
    async createTask(db: Db, actor: ActorContext, input: CreateTaskInput): Promise<Task> {
      const parsed = CreateTask.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues);
      return db.transaction(async (tx) => {
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
            ...parsed.data,
            orgId: actor.orgId,
            key: formatTaskKey(settings.taskKeyPrefix, counter.seq),
            createdBy: actor.principalId,
          })
          .returning();
        if (!task) throw new Error('Missing inserted task');
        return changed(tx, actor, task, 'task.create');
      });
    },
    async cancelTask(db: Db, actor: ActorContext, id: string): Promise<Task> {
      return db.transaction(async (tx) => {
        const task = await get(tx, actor, id);
        await deps.authorizer.authorize(tx, actor, 'task.write', resource(task.target));
        if (!['queued', 'claimed', 'running'].includes(task.status))
          throw conflict('task_terminal', 'Task is already terminal');
        return update(tx, actor, id, { status: 'cancelled' }, 'task.cancel');
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
    async claimNextTask(tx: Tx, actor: ActorContext, workerId: string): Promise<Task | null> {
      system(actor);
      await deps.authorizer.authorize(tx, actor, 'task.write', {});
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.status, 'queued')))
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
      return update(tx, actor, id, { status, error: error ?? null }, 'task.status');
    },
  };
}
