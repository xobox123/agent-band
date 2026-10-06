import { z } from 'zod';
import { NormalizedEvent } from '../runner.ts';
import { Id, IsoDate, listOf } from './common.ts';

export const RunStatus = z.enum(['running', 'done', 'failed', 'rate_limited', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunDto = z.object({
  id: Id,
  orgId: Id,
  taskId: Id,
  agentId: Id,
  accountId: Id,
  workerId: z.string(),
  effectivePolicy: z.record(z.string(), z.unknown()),
  skills: z.array(z.object({ skillId: z.string(), version: z.number(), contentHash: z.string() })),
  status: RunStatus,
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  exitCode: z.number().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  costUsd: z.number().nullable(),
  rateLimitResetsAt: IsoDate.nullable(),
  error: z.string().nullable(),
});
export type RunDto = z.infer<typeof RunDto>;
export const RunList = listOf(RunDto);

export const RunQuery = z.object({
  taskId: Id.optional(),
  agentId: Id.optional(),
  accountId: Id.optional(),
  status: RunStatus.optional(),
});

export const RunEventDto = z.object({
  id: z.number().int(),
  runId: Id,
  ts: IsoDate,
  kind: z.string(),
  payload: NormalizedEvent,
});
export type RunEventDto = z.infer<typeof RunEventDto>;
export const RunEventList = listOf(RunEventDto);

export const RunEventsQuery = z.object({ afterId: z.coerce.number().int().nonnegative().default(0) });
