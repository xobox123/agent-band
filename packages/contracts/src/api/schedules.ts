import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';
import { TaskMode, TaskPriority, TaskTarget } from './tasks.ts';

export const ScheduleOverlap = z.enum(['skip', 'queue']);
export type ScheduleOverlap = z.infer<typeof ScheduleOverlap>;

export const ScheduleTemplate = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    /** Omit to use a folder under the workspace root named after the schedule. */
    workDir: z.string().startsWith('/').max(4096).optional(),
    target: TaskTarget,
    priority: TaskPriority.default(2),
    mode: TaskMode.optional(),
  })
  .strict();
export type ScheduleTemplate = z.infer<typeof ScheduleTemplate>;

const Cron = z.string().trim().min(1).max(200);
/** IANA time zone name, e.g. `Europe/Warsaw`. */
const Timezone = z.string().min(1).max(100);

export const ScheduleDto = z.object({
  id: Id,
  orgId: Id,
  name: z.string(),
  enabled: z.boolean(),
  /** Five-field cron expression. */
  cron: z.string(),
  /** Null means the organisation time zone. */
  timezone: z.string().nullable(),
  template: ScheduleTemplate,
  overlap: ScheduleOverlap,
  lastFiredAt: IsoDate.nullable(),
  /** Task created by the latest fire or run-now; look it up through `GET /schedules/:id/tasks`. */
  lastTaskId: Id.nullable(),
  nextFireAt: IsoDate,
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ScheduleDto = z.infer<typeof ScheduleDto>;
export const ScheduleList = listOf(ScheduleDto);

export const CreateScheduleBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    cron: Cron,
    timezone: Timezone.optional(),
    template: ScheduleTemplate,
    overlap: ScheduleOverlap.default('skip'),
  })
  .strict();
export type CreateScheduleBody = z.input<typeof CreateScheduleBody>;

export const UpdateScheduleBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
    cron: Cron,
    timezone: Timezone.nullable(),
    template: ScheduleTemplate,
    overlap: ScheduleOverlap,
  })
  .partial()
  .strict();
export type UpdateScheduleBody = z.infer<typeof UpdateScheduleBody>;

export const SchedulePreviewQuery = z.object({ cron: Cron, timezone: Timezone.optional() });
export type SchedulePreviewQuery = z.infer<typeof SchedulePreviewQuery>;

/** The next five fire times, ISO UTC. */
export const SchedulePreviewDto = z.object({ fireTimes: z.array(IsoDate) });
export type SchedulePreviewDto = z.infer<typeof SchedulePreviewDto>;
