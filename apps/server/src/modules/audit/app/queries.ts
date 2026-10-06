import { and, asc, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { invalid } from '../../../platform/errors.ts';
import type { Authorizer } from '../../../ports/index.ts';
import { GENESIS_HASH, verifyChain, type AuditRow } from '../domain/hash.ts';
import { auditEvents } from '../infra/schema.ts';

export interface AuditEventDto {
  seq: number;
  orgId: string;
  ts: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  data: unknown;
  prevHash: string;
  hash: string;
}

export interface AuditFilter {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  cursor?: number;
  limit?: number;
}

export interface AuditExportFilter extends Omit<AuditFilter, 'cursor' | 'limit'> {
  toSeq?: number;
}

export interface AuditRange {
  fromSeq?: number;
  toSeq?: number;
}

export interface VerifyResult {
  ok: boolean;
  brokenAtSeq?: number;
  count: number;
  fromSeq: number | null;
  toSeq: number | null;
}

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date');
const seqNum = z.number().int().nonnegative();
const filterSchema = z.object({
  actorId: z.uuid().optional(),
  action: z.string().min(1).optional(),
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: seqNum.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const exportSchema = filterSchema.omit({ cursor: true, limit: true }).extend({ toSeq: seqNum.optional() });
const rangeSchema = z.object({ fromSeq: seqNum.optional(), toSeq: seqNum.optional() });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw invalid(r.error.issues);
  return r.data;
}

type Row = typeof auditEvents.$inferSelect;

function toDto(r: Row): AuditEventDto {
  return {
    seq: r.seq,
    orgId: r.orgId,
    ts: r.ts.toISOString(),
    actorId: r.actorId,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    data: r.data,
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

function toChainRow(r: Row): AuditRow {
  return { ...toDto(r) };
}

function filterConds(orgId: string, f: AuditExportFilter): SQL[] {
  const conds: SQL[] = [eq(auditEvents.orgId, orgId)];
  if (f.actorId) conds.push(eq(auditEvents.actorId, f.actorId));
  if (f.action) conds.push(eq(auditEvents.action, f.action));
  if (f.targetType) conds.push(eq(auditEvents.targetType, f.targetType));
  if (f.targetId) conds.push(eq(auditEvents.targetId, f.targetId));
  if (f.from) conds.push(gte(auditEvents.ts, new Date(f.from)));
  if (f.to) conds.push(lte(auditEvents.ts, new Date(f.to)));
  if (f.toSeq !== undefined) conds.push(lte(auditEvents.seq, f.toSeq));
  return conds;
}

const BATCH = 500;

export function createAudit(authorizer: Authorizer): {
  listAudit(
    db: Db,
    actor: ActorContext,
    f: AuditFilter,
  ): Promise<{ items: AuditEventDto[]; nextCursor: number | null }>;
  verifyAudit(db: Db, actor: ActorContext, range?: AuditRange): Promise<VerifyResult>;
  exportAudit(db: Db, actor: ActorContext, f?: AuditExportFilter): AsyncIterable<string>;
} {
  async function listAudit(db: Db, actor: ActorContext, input: AuditFilter) {
    const f = parse(filterSchema, input);
    await authorizer.authorize(db, actor, 'read', {});
    const limit = f.limit ?? 50;
    const conds = filterConds(actor.orgId, f);
    if (f.cursor !== undefined) conds.push(lt(auditEvents.seq, f.cursor));
    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(...conds))
      .orderBy(desc(auditEvents.seq))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDto),
      nextCursor: rows.length > limit && last ? last.seq : null,
    };
  }

  async function verifyAudit(db: Db, actor: ActorContext, input: AuditRange = {}): Promise<VerifyResult> {
    const range = parse(rangeSchema, input);
    await authorizer.authorize(db, actor, 'read', {});
    const orgId = actor.orgId;
    const from = range.fromSeq ?? 0;

    let prev = GENESIS_HASH;
    if (from > 0) {
      const before = await db
        .select({ hash: auditEvents.hash })
        .from(auditEvents)
        .where(and(eq(auditEvents.orgId, orgId), lt(auditEvents.seq, from)))
        .orderBy(desc(auditEvents.seq))
        .limit(1);
      prev = before[0]?.hash ?? GENESIS_HASH;
    }

    let count = 0;
    let firstSeq: number | null = null;
    let lastSeq: number | null = null;
    let cursor = from > 0 ? from - 1 : -1;
    for (;;) {
      const conds = [eq(auditEvents.orgId, orgId), gte(auditEvents.seq, cursor + 1)];
      if (range.toSeq !== undefined) conds.push(lte(auditEvents.seq, range.toSeq));
      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(...conds))
        .orderBy(asc(auditEvents.seq))
        .limit(BATCH);
      if (rows.length === 0) break;
      const result = verifyChain(rows.map(toChainRow), prev);
      const batchFirst = rows[0];
      const batchLast = rows[rows.length - 1];
      if (!batchFirst || !batchLast) break;
      if (!result.ok) {
        return {
          ok: false,
          brokenAtSeq: result.brokenAtSeq,
          count: count + rows.filter((r) => r.seq <= result.brokenAtSeq).length,
          fromSeq: firstSeq ?? batchFirst.seq,
          toSeq: result.brokenAtSeq,
        };
      }
      firstSeq ??= batchFirst.seq;
      lastSeq = batchLast.seq;
      count += rows.length;
      prev = batchLast.hash;
      cursor = batchLast.seq;
      if (rows.length < BATCH) break;
    }
    return { ok: true, count, fromSeq: firstSeq, toSeq: lastSeq };
  }

  async function* exportAudit(
    db: Db,
    actor: ActorContext,
    input: AuditExportFilter = {},
  ): AsyncGenerator<string> {
    const f = parse(exportSchema, input);
    await authorizer.authorize(db, actor, 'audit.export', {});
    let toSeq = f.toSeq;
    if (toSeq === undefined) {
      const top = await db
        .select({ seq: auditEvents.seq })
        .from(auditEvents)
        .where(eq(auditEvents.orgId, actor.orgId))
        .orderBy(desc(auditEvents.seq))
        .limit(1);
      toSeq = top[0]?.seq ?? 0;
    }
    let cursor = -1;
    for (;;) {
      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(...filterConds(actor.orgId, { ...f, toSeq }), gte(auditEvents.seq, cursor + 1)))
        .orderBy(asc(auditEvents.seq))
        .limit(BATCH);
      for (const r of rows) yield JSON.stringify(toDto(r)) + '\n';
      const last = rows[rows.length - 1];
      if (!last || rows.length < BATCH) return;
      cursor = last.seq;
    }
  }

  return { listAudit, verifyAudit, exportAudit };
}
