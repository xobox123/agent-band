import { desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../../platform/tx.ts';
import type { AuditEntry } from '../../../ports/index.ts';
import { auditHash, GENESIS_HASH } from '../domain/hash.ts';
import { auditEvents } from '../infra/schema.ts';

export async function appendAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'audit:' + e.orgId}))`);
  const last = await tx
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.orgId, e.orgId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const prevHash = last[0]?.hash ?? GENESIS_HASH;
  const seqRows = (await tx.execute(
    sql`select nextval(pg_get_serial_sequence('audit_events', 'seq')) as seq`,
  )) as { rows: { seq: string }[] };
  const seq = Number(seqRows.rows[0]?.seq);
  if (!Number.isSafeInteger(seq)) throw new Error('audit sequence returned no value');
  const ts = new Date();
  // Round-trip through JSON so the hashed value equals what jsonb returns.
  const data: unknown = JSON.parse(JSON.stringify(e.data ?? {}));
  const hash = auditHash(prevHash, {
    seq,
    orgId: e.orgId,
    ts: ts.toISOString(),
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    data,
  });
  await tx.insert(auditEvents).values({
    seq,
    orgId: e.orgId,
    ts,
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    data,
    prevHash,
    hash,
  });
}
