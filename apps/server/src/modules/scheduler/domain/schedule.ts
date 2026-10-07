import { z } from 'zod';
import { TaskTarget } from '../../tasks/index.ts';

export const ScheduleTemplate = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    workDir: z.string().startsWith('/').max(4096).optional(),
    target: TaskTarget,
    priority: z.number().int().min(0).max(3).default(2),
    mode: z.enum(['read-only', 'edit', 'full-auto']).optional(),
  })
  .strict();
export type ScheduleTemplate = z.infer<typeof ScheduleTemplate>;

export const CreateSchedule = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    cron: z.string().trim().min(1).max(200),
    timezone: z.string().min(1).max(100).optional(),
    template: ScheduleTemplate,
    overlap: z.enum(['skip', 'queue']).default('skip'),
  })
  .strict();
export type CreateScheduleInput = z.input<typeof CreateSchedule>;

export const UpdateSchedule = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
    cron: z.string().trim().min(1).max(200),
    timezone: z.string().min(1).max(100).nullable(),
    template: ScheduleTemplate,
    overlap: z.enum(['skip', 'queue']),
  })
  .partial()
  .strict();
export type UpdateScheduleInput = z.input<typeof UpdateSchedule>;
