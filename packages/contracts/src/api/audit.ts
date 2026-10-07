import { z } from 'zod';
import { Id, IsoDate } from './common.ts';

export const AuditEventDto = z.object({
  seq: z.number().int(),
  orgId: Id,
  ts: IsoDate,
  actorId: Id,
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  data: z.unknown(),
  prevHash: z.string(),
  hash: z.string(),
});
export type AuditEventDto = z.infer<typeof AuditEventDto>;

const seq = z.coerce.number().int().nonnegative();

const AuditFilterShape = {
  actorId: Id.optional(),
  involving: Id.optional(),
  action: z.string().min(1).optional(),
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

export const AuditQuery = z.object({
  ...AuditFilterShape,
  /** Return events with seq below this value (events are newest first). */
  cursor: seq.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof AuditQuery>;

export const AuditListDto = z.object({
  items: z.array(AuditEventDto),
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: z.number().int().nullable(),
  /** Latest outbox event id at read time. */
  cursor: z.number().int().nonnegative(),
});

export const AuditVerifyQuery = z.object({ fromSeq: seq.optional(), toSeq: seq.optional() });

export const AuditVerifyDto = z.object({
  ok: z.boolean(),
  brokenAtSeq: z.number().int().optional(),
  count: z.number().int(),
  fromSeq: z.number().int().nullable(),
  toSeq: z.number().int().nullable(),
});
export type AuditVerifyDto = z.infer<typeof AuditVerifyDto>;

export const AuditExportQuery = z.object({ ...AuditFilterShape, toSeq: seq.optional() });
