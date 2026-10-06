import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  BoardDto,
  CreateTaskBody,
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
  UpdateTaskBody,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { runDto, runEventDto, taskDto } from '../dto.ts';

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
        const task = await c.tasks.createTask(db, await c.resolveActor(req), {
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
