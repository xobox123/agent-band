import { asc, eq, gt, lt, max, sql } from 'drizzle-orm';
import type { Database, Db } from './db.ts';
import { outboxEvents } from './schema.ts';
import type { Tx } from './tx.ts';

export const OUTBOX_CHANNEL = 'agent_band_events';
export const OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface OutboxEvent {
  id: number;
  type: string;
  payload: unknown;
}

export async function publish(tx: Tx, type: string, payload: unknown): Promise<void> {
  const rows = await tx.insert(outboxEvents).values({ type, payload }).returning({ id: outboxEvents.id });
  const row = rows[0];
  if (!row) throw new Error('outbox insert returned no row');
  await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, ${String(row.id)})`);
}

export class EventStream {
  private readonly subscribers = new Set<(e: OutboxEvent) => void>();
  private unlisten: (() => Promise<void>) | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly database: Database) {}

  async start(): Promise<void> {
    if (this.unlisten) return;
    this.stopped = false;
    this.unlisten = await this.database.listen(OUTBOX_CHANNEL, (payload) => {
      this.chain = this.chain.then(() => this.deliver(payload)).catch(() => undefined);
    });
  }

  subscribe(fn: (e: OutboxEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const unlisten = this.unlisten;
    this.unlisten = undefined;
    if (unlisten) await unlisten();
    await this.chain;
  }

  private async deliver(payload: string): Promise<void> {
    const id = Number(payload);
    if (this.stopped || !Number.isSafeInteger(id)) return;
    const rows = await this.database.db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    const row = rows[0];
    if (!row) return;
    const event: OutboxEvent = { id: row.id, type: row.type, payload: row.payload };
    for (const fn of [...this.subscribers]) {
      try {
        fn(event);
      } catch {
        // a failing subscriber must not affect others
      }
    }
  }
}

async function sequenceValue(db: Db): Promise<number> {
  const result = await db.execute(
    sql`select case when is_called then last_value else 0 end as last from outbox_events_id_seq`,
  );
  const rows = (result as { rows: { last: string | number | null }[] }).rows;
  const last = rows[0]?.last;
  return last == null ? 0 : Number(last);
}

/** Latest committed outbox id at read time (the list `cursor`); falls back to the sequence when pruned empty. */
export async function latestOutboxId(db: Db): Promise<number> {
  const rows = await db.select({ id: max(outboxEvents.id) }).from(outboxEvents);
  const id = rows[0]?.id;
  return id == null ? sequenceValue(db) : id;
}

/** Highest id ever handed out; ids above it cannot belong to this database. */
export async function highestIssuedOutboxId(db: Db): Promise<number> {
  return Math.max(await sequenceValue(db), await latestOutboxId(db));
}

/** Smallest id still stored, or null when the table is empty. */
export async function oldestOutboxId(db: Db): Promise<number | null> {
  const rows = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .orderBy(asc(outboxEvents.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function outboxSince(db: Db, afterId: number, limit: number): Promise<OutboxEvent[]> {
  const rows = await db
    .select()
    .from(outboxEvents)
    .where(gt(outboxEvents.id, afterId))
    .orderBy(asc(outboxEvents.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, type: r.type, payload: r.payload }));
}

/** Deletes outbox rows older than the retention window; returns the number removed. */
export async function pruneOutbox(
  db: Db,
  now: Date = new Date(),
  retentionMs: number = OUTBOX_RETENTION_MS,
): Promise<number> {
  const rows = await db
    .delete(outboxEvents)
    .where(lt(outboxEvents.ts, new Date(now.getTime() - retentionMs)))
    .returning({ id: outboxEvents.id });
  return rows.length;
}
