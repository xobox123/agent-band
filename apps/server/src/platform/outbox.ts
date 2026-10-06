import { eq, sql } from 'drizzle-orm';
import type { Database } from './db.ts';
import { outboxEvents } from './schema.ts';
import type { Tx } from './tx.ts';

export const OUTBOX_CHANNEL = 'agent_band_events';

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
