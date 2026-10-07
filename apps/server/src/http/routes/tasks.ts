import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AddPlanTaskBody,
  ApprovePlanBody,
  BoardDto,
  CreateTaskBody,
  GoalList,
  GoalStateDto,
  IdParams,
  RejectPlanBody,
  StartTaskBody,
  StartTasksBody,
  ToBacklogBody,
  ReorderTaskBody,
  RunEventList,
  RunEventsQuery,
  RunDto,
  RunList,
  RunQuery,
  TaskDto,
  TaskList,
  TaskQuery,
  TaskTreeDto,
  UpdateTaskBody,
} from '@agent-band/contracts';
import type { ActorContext } from '../../platform/actor.ts';
import type { Task } from '../../modules/tasks/index.ts';
import type { Composition } from '../../composition.ts';
import { goalDto, runDto, runEventDto, taskDto } from '../dto.ts';
import { conflict, invalid } from '../../platform/errors.ts';
import { planStart } from '../start-when.ts';
import { assertWorkDirAllowed } from '../work-dir.ts';

export function taskRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  async function dtos(actor: ActorContext, tasks: Task[]) {
    const runs = await c.runs.latestByTask(
      db,
      actor,
      tasks.map((t) => t.id),
    );
    const latest = new Map(runs.map((r) => [r.taskId, r]));
    return tasks.map((t) => {
      const run = latest.get(t.id);
      return { ...taskDto(t), latestRun: run ? runDto(run) : null };
    });
  }
  async function dto(actor: ActorContext, task: Task) {
    const [result] = await dtos(actor, [task]);
    if (!result) throw new Error('task dto missing');
    return result;
  }
  async function accountFilter(actor: ActorContext, accountId?: string) {
    if (!accountId) return {};
    const [runs, agents] = await Promise.all([
      c.runs.listRuns(db, actor, { accountId }),
      c.agents.listAgents(db, actor),
    ]);
    return {
      accountTaskIds: [...new Set(runs.map((r) => r.taskId))],
      accountAgentIds: agents.filter((a) => a.accountId === accountId).map((a) => a.id),
    };
  }
  function page<T extends { id: string }>(rows: T[], limit: number, at: (row: T) => Date) {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last ? JSON.stringify({ at: at(last).toISOString(), id: last.id }) : null,
    };
  }
  return (app, _opts, done) => {
    app.get(
      '/tasks',
      {
        schema: {
          tags: ['tasks'],
          summary: 'List tasks',
          querystring: TaskQuery,
          response: { 200: TaskList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        const actor = await c.resolveActor(req);
        const terminal =
          req.query.status && ['done', 'failed', 'cancelled', 'denied'].includes(req.query.status);
        if (req.query.pageCursor && !terminal) throw invalid('pageCursor requires a terminal status');
        const items = await c.tasks.listTasks(db, actor, {
          ...req.query,
          ...(await accountFilter(actor, req.query.accountId)),
          limit: terminal ? req.query.limit + 1 : undefined,
          ...(req.query.status === 'failed'
            ? { status: undefined, statuses: ['failed' as const, 'denied' as const] }
            : {}),
        });
        const result = page(items, terminal ? req.query.limit : items.length, (t) => t.createdAt);
        return { ...result, items: await dtos(actor, result.items), cursor };
      },
    );

    app.post(
      '/tasks',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Create a task',
          body: CreateTaskBody,
          response: { 201: TaskDto },
        },
      },
      async (req, reply) => {
        const { runAt, ...body } = req.body;
        const actor = await c.resolveActor(req);
        if (body.kind === 'goal' && 'agentId' in body.target) {
          const leader = await c.agents.getAgent(db, actor, body.target.agentId);
          if (leader.role !== 'leader')
            throw invalid([{ path: 'target', message: 'a goal needs an agent with role leader' }]);
        }
        if (body.workDir) await assertWorkDirAllowed(c, actor, body.target, body.workDir);
        const task = await c.tasks.createTask(db, actor, {
          ...body,
          ...(runAt ? { runAt: new Date(runAt) } : {}),
        });
        return reply.code(201).send(await dto(actor, task));
      },
    );

    app.get(
      '/tasks/:id',
      {
        schema: { tags: ['tasks'], summary: 'Get a task', params: IdParams, response: { 200: TaskDto } },
      },
      async (req) =>
        dto(await c.resolveActor(req), await c.tasks.getTask(db, await c.resolveActor(req), req.params.id)),
    );

    app.get(
      '/tasks/:id/tree',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Goal tree: goal state, subtasks and tokens per task',
          params: IdParams,
          response: { 200: TaskTreeDto },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        const { goal, tasks } = await c.tasks.getTaskTree(db, await c.resolveActor(req), req.params.id);
        const tokens = await c.runs.tokensByTask(
          db,
          await c.resolveActor(req),
          tasks.map((t) => t.id),
        );
        const total = Object.values(tokens).reduce((a, b) => a + b, 0);
        return {
          cursor,
          goal: goalDto(goal, total),
          tasks: (await dtos(await c.resolveActor(req), tasks)).map((t) => ({
            ...t,
            tokens: tokens[t.id] ?? 0,
          })),
        };
      },
    );

    app.get(
      '/goals',
      {
        schema: { tags: ['tasks'], summary: 'List goals with their state', response: { 200: GoalList } },
      },
      async (req) => {
        const cursor = await c.cursor();
        const rows = await c.tasks.listGoals(db, await c.resolveActor(req));
        return {
          items: await Promise.all(
            rows.map(async (r) => ({
              goal: goalDto(r.goal),
              task: await dto(await c.resolveActor(req), r.task),
            })),
          ),
          cursor,
        };
      },
    );

    app.patch(
      '/tasks/:id',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Edit a backlog (draft) task, or change the priority of a queued task',
          params: IdParams,
          body: UpdateTaskBody,
          response: { 200: TaskDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const current = await c.tasks.getTask(db, actor, req.params.id);
        const { runAt, ...rest } = req.body;
        if (current.status === 'draft' && rest.workDir)
          await assertWorkDirAllowed(c, actor, rest.target ?? current.target, rest.workDir);
        if (current.status === 'draft')
          return dto(
            actor,
            await c.tasks.updateDraft(db, actor, req.params.id, {
              ...rest,
              ...(runAt !== undefined ? { runAt: runAt === null ? null : new Date(runAt) } : {}),
            }),
          );
        if (Object.keys(req.body).length !== 1 || req.body.priority === undefined)
          throw conflict('task_not_draft', 'Only draft tasks can be edited');
        return dto(actor, await c.tasks.setTaskPriority(db, actor, req.params.id, req.body.priority));
      },
    );

    app.delete(
      '/tasks/:id',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Delete a backlog (draft) task',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.tasks.deleteDraft(db, await c.resolveActor(req), req.params.id);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/tasks/start',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Start backlog tasks (all or none)',
          body: StartTasksBody,
          response: { 200: TaskList },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const found = await Promise.all(req.body.ids.map((id) => c.tasks.getTask(db, actor, id)));
        const plan = await planStart(c, actor, found, req.body.when);
        const started = await c.tasks.startTasks(db, actor, req.body.ids, plan);
        return { items: await dtos(actor, started), nextCursor: null, cursor: await c.cursor() };
      },
    );

    app.post(
      '/tasks/to-backlog',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Move failed, denied, cancelled or rate-limited tasks back to the backlog (all or none)',
          body: ToBacklogBody,
          response: { 200: TaskList },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const moved = await c.tasks.moveToBacklog(db, actor, req.body.ids);
        return { items: await dtos(actor, moved), nextCursor: null, cursor: await c.cursor() };
      },
    );

    app.post(
      '/tasks/:id/to-backlog',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Move a failed, denied, cancelled or rate-limited task back to the backlog',
          params: IdParams,
          response: { 200: TaskDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const [moved] = await c.tasks.moveToBacklog(db, actor, [req.params.id]);
        if (!moved) throw new Error('to-backlog returned no task');
        return dto(actor, moved);
      },
    );

    app.post(
      '/tasks/:id/start',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Start a backlog task',
          params: IdParams,
          body: StartTaskBody,
          response: { 200: TaskDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const task = await c.tasks.getTask(db, actor, req.params.id);
        const plan = await planStart(c, actor, [task], req.body.when);
        const [started] = await c.tasks.startTasks(db, actor, [req.params.id], plan);
        if (!started) throw new Error('start returned no task');
        return dto(actor, started);
      },
    );

    app.post(
      '/goals/:id/approve',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Approve the leader plan: queue its proposed subtasks',
          params: IdParams,
          body: ApprovePlanBody,
          response: { 200: GoalStateDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const tree = await c.tasks.listTree(db, actor.orgId, req.params.id);
        const proposed = tree.filter((t) => t.status === 'draft' && t.proposed);
        const plan = await planStart(c, actor, proposed, req.body.when);
        return goalDto(await c.goalApproval.approvePlan(db, actor, req.params.id, plan));
      },
    );

    app.post(
      '/goals/:id/reject',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Reject the leader plan with feedback; the leader plans again',
          params: IdParams,
          body: RejectPlanBody,
          response: { 200: GoalStateDto },
        },
      },
      async (req) =>
        goalDto(
          await c.goalApproval.rejectPlan(db, await c.resolveActor(req), req.params.id, req.body.feedback),
        ),
    );

    app.post(
      '/goals/:id/subtasks',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Add a subtask to the plan awaiting approval',
          params: IdParams,
          body: AddPlanTaskBody,
          response: { 201: TaskDto },
        },
      },
      async (req, reply) => {
        const actor = await c.resolveActor(req);
        const task = await c.goalApproval.addPlanTask(db, actor, req.params.id, req.body);
        return reply.code(201).send(await dto(actor, task));
      },
    );

    app.post(
      '/tasks/:id/cancel',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Cancel a task; publishes task.cancel_requested',
          params: IdParams,
          response: { 200: TaskDto },
        },
      },
      async (req) =>
        dto(
          await c.resolveActor(req),
          await c.tasks.cancelTask(db, await c.resolveActor(req), req.params.id),
        ),
    );

    app.post(
      '/tasks/:id/reorder',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Move a queued task before another (or to the end)',
          params: IdParams,
          body: ReorderTaskBody,
          response: { 200: TaskDto },
        },
      },
      async (req) =>
        dto(
          await c.resolveActor(req),
          await c.tasks.reorderTask(db, await c.resolveActor(req), req.params.id, req.body.beforeId),
        ),
    );

    app.get(
      '/board',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Board view: tasks grouped by column',
          querystring: TaskQuery,
          response: { 200: BoardDto },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        const actor = await c.resolveActor(req);
        if (req.query.pageCursor)
          throw invalid('Use /tasks with a terminal status to fetch the next column page');
        const filter = {
          ...req.query,
          ...(await accountFilter(actor, req.query.accountId)),
          limit: undefined,
        };
        const columns = await c.tasks.boardView(db, actor, {
          ...filter,
          statuses: ['draft', 'scheduled', 'queued', 'claimed', 'running', 'rate_limited'],
        });
        const nextCursors = { done: null, failed: null, cancelled: null } as Record<
          'done' | 'failed' | 'cancelled',
          string | null
        >;
        for (const status of ['done', 'failed', 'cancelled'] as const) {
          const rows = await c.tasks.listTasks(db, actor, {
            ...filter,
            statuses: status === 'failed' ? ['failed', 'denied'] : [status],
            limit: req.query.limit + 1,
          });
          const result = page(rows, req.query.limit, (t) => t.createdAt);
          columns[status] = result.items;
          nextCursors[status] = result.nextCursor;
        }
        const mapped = await dtos(actor, Object.values(columns).flat());
        const byId = new Map(mapped.map((t) => [t.id, t]));
        const column = (tasks: Task[]) => tasks.flatMap((t) => byId.get(t.id) ?? []);
        return {
          cursor,
          nextCursors,
          columns: {
            draft: column(columns.draft),
            scheduled: column(columns.scheduled),
            queued: column(columns.queued),
            running: column(columns.running),
            rate_limited: column(columns.rate_limited),
            done: column(columns.done),
            failed: column(columns.failed),
            cancelled: column(columns.cancelled),
          },
        };
      },
    );

    app.get(
      '/runs',
      {
        schema: {
          tags: ['runs'],
          summary: 'List runs',
          querystring: RunQuery,
          response: { 200: RunList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        const actor = await c.resolveActor(req);
        const taskIds = req.query.text
          ? (await c.tasks.listTasks(db, actor, { text: req.query.text })).map((t) => t.id)
          : undefined;
        const rows = await c.runs.listRuns(db, actor, { ...req.query, taskIds, limit: req.query.limit + 1 });
        const result = page(rows, req.query.limit, (r) => r.startedAt);
        return { ...result, items: result.items.map(runDto), cursor };
      },
    );

    app.get(
      '/runs/:id',
      {
        schema: { tags: ['runs'], summary: 'Get a run', params: IdParams, response: { 200: RunDto } },
      },
      async (req) => runDto(await c.runs.getRun(db, await c.resolveActor(req), req.params.id)),
    );

    app.get(
      '/runs/:id/events',
      {
        schema: {
          tags: ['runs'],
          summary: 'Run events after an event id',
          params: IdParams,
          querystring: RunEventsQuery,
          response: { 200: RunEventList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        const items = await c.runs.listRunEvents(
          db,
          await c.resolveActor(req),
          req.params.id,
          req.query.afterId,
        );
        return { items: items.map(runEventDto), cursor };
      },
    );
    done();
  };
}
