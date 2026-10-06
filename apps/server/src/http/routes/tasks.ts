import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  BoardDto,
  CreateTaskBody,
  GoalList,
  IdParams,
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
import type { Composition } from '../../composition.ts';
import { goalDto, runDto, runEventDto, taskDto } from '../dto.ts';
import { invalid } from '../../platform/errors.ts';

export function taskRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
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
        const items = await c.tasks.listTasks(db, await c.resolveActor(req), req.query);
        return { items: items.map(taskDto), cursor };
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
        const task = await c.tasks.createTask(db, actor, {
          ...body,
          ...(runAt ? { runAt: new Date(runAt) } : {}),
        });
        return reply.code(201).send(taskDto(task));
      },
    );

    app.get(
      '/tasks/:id',
      {
        schema: { tags: ['tasks'], summary: 'Get a task', params: IdParams, response: { 200: TaskDto } },
      },
      async (req) => taskDto(await c.tasks.getTask(db, await c.resolveActor(req), req.params.id)),
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
          tasks: tasks.map((t) => ({ ...taskDto(t), tokens: tokens[t.id] ?? 0 })),
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
        return { items: rows.map((r) => ({ goal: goalDto(r.goal), task: taskDto(r.task) })), cursor };
      },
    );

    app.patch(
      '/tasks/:id',
      {
        schema: {
          tags: ['tasks'],
          summary: 'Change task priority (queued tasks only)',
          params: IdParams,
          body: UpdateTaskBody,
          response: { 200: TaskDto },
        },
      },
      async (req) =>
        taskDto(
          await c.tasks.setTaskPriority(db, await c.resolveActor(req), req.params.id, req.body.priority),
        ),
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
      async (req) => taskDto(await c.tasks.cancelTask(db, await c.resolveActor(req), req.params.id)),
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
        taskDto(await c.tasks.reorderTask(db, await c.resolveActor(req), req.params.id, req.body.beforeId)),
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
        const columns = await c.tasks.boardView(db, await c.resolveActor(req), req.query);
        return {
          cursor,
          columns: {
            scheduled: columns.scheduled.map(taskDto),
            queued: columns.queued.map(taskDto),
            running: columns.running.map(taskDto),
            rate_limited: columns.rate_limited.map(taskDto),
            done: columns.done.map(taskDto),
            failed: columns.failed.map(taskDto),
            cancelled: columns.cancelled.map(taskDto),
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
        const items = await c.runs.listRuns(db, await c.resolveActor(req), req.query);
        return { items: items.map(runDto), cursor };
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
