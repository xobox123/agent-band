import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateScheduleBody,
  IdParams,
  ScheduleDto,
  ScheduleList,
  SchedulePreviewDto,
  SchedulePreviewQuery,
  TaskDto,
  TaskList,
  UpdateScheduleBody,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { scheduleDto, taskDto, runDto } from '../dto.ts';

export function scheduleRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  return (app, _opts, done) => {
    app.get(
      '/schedules',
      {
        schema: { tags: ['schedules'], summary: 'List schedules', response: { 200: ScheduleList } },
      },
      async (req) => {
        const cursor = await c.cursor();
        const items = await c.scheduler.listSchedules(db, await c.resolveActor(req));
        return { items: items.map(scheduleDto), cursor };
      },
    );

    app.get(
      '/schedules/preview',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Next five fire times of a cron expression',
          querystring: SchedulePreviewQuery,
          response: { 200: SchedulePreviewDto },
        },
      },
      async (req) => {
        const times = await c.scheduler.preview(
          db,
          await c.resolveActor(req),
          req.query.cron,
          req.query.timezone,
        );
        return { fireTimes: times.map((t) => t.toISOString()) };
      },
    );

    app.post(
      '/schedules',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Create a schedule',
          body: CreateScheduleBody,
          response: { 201: ScheduleDto },
        },
      },
      async (req, reply) =>
        reply
          .code(201)
          .send(scheduleDto(await c.scheduler.createSchedule(db, await c.resolveActor(req), req.body))),
    );

    app.get(
      '/schedules/:id',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Get a schedule',
          params: IdParams,
          response: { 200: ScheduleDto },
        },
      },
      async (req) => scheduleDto(await c.scheduler.getSchedule(db, await c.resolveActor(req), req.params.id)),
    );

    app.patch(
      '/schedules/:id',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Update a schedule',
          params: IdParams,
          body: UpdateScheduleBody,
          response: { 200: ScheduleDto },
        },
      },
      async (req) =>
        scheduleDto(await c.scheduler.updateSchedule(db, await c.resolveActor(req), req.params.id, req.body)),
    );

    app.delete(
      '/schedules/:id',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Delete a schedule; tasks it created are kept',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.scheduler.deleteSchedule(db, await c.resolveActor(req), req.params.id);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/schedules/:id/run-now',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Create a task from the template now; the next fire time does not move',
          params: IdParams,
          response: { 201: TaskDto },
        },
      },
      async (req, reply) => {
        const actor = await c.resolveActor(req);
        const { taskId } = await c.scheduler.runNow(db, actor, req.params.id);
        return reply.code(201).send(taskDto(await c.tasks.getTask(db, actor, taskId)));
      },
    );

    app.get(
      '/schedules/:id/tasks',
      {
        schema: {
          tags: ['schedules'],
          summary: 'Tasks created by a schedule',
          params: IdParams,
          response: { 200: TaskList },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        await c.scheduler.getSchedule(db, actor, req.params.id);
        const cursor = await c.cursor();
        const items = await c.tasks.listTasks(db, actor, { scheduleId: req.params.id });
        const runs = await c.runs.latestByTask(
          db,
          actor,
          items.map((t) => t.id),
        );
        return {
          items: items.map((t) => {
            const run = runs.find((r) => r.taskId === t.id);
            return { ...taskDto(t), latestRun: run ? runDto(run) : null };
          }),
          cursor,
          nextCursor: null,
        };
      },
    );
    done();
  };
}
