import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SSE_HEARTBEAT_MS, OUTBOX_RETENTION_MS } from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import {
  highestIssuedOutboxId,
  latestOutboxId,
  oldestOutboxId,
  outboxSince,
  type OutboxEvent,
} from '../../platform/outbox.ts';

export interface SseOptions {
  heartbeatMs?: number;
  /** Replays larger than this are answered with `reset`. */
  maxReplay?: number;
}

export { OUTBOX_RETENTION_MS };

function parseEventId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function frame(e: OutboxEvent): string {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`;
}

function belongsToOrg(e: OutboxEvent, orgId: string): boolean {
  const p = e.payload;
  return typeof p === 'object' && p !== null && (p as { orgId?: unknown }).orgId === orgId;
}

export function eventRoutes(c: Composition, opts: SseOptions = {}): FastifyPluginCallbackZod {
  const db = c.database.db;
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const maxReplay = opts.maxReplay ?? 5000;

  return (app, _opts, done) => {
    const open = new Set<() => void>();
    app.addHook('preClose', () => {
      for (const close of [...open]) close();
    });

    app.get(
      '/events',
      {
        schema: {
          tags: ['events'],
          summary:
            'Server-sent events: id is the outbox id, honours Last-Event-ID, sends `reset` when the id is too old',
          querystring: z.object({ lastEventId: z.string().optional() }),
        },
      },
      async (req, reply) => {
        const actor = await c.resolveActor(req);
        await c.ports.authorizer.authorize(db, actor, 'read', {});
        const lastId = parseEventId(req.headers['last-event-id']) ?? parseEventId(req.query.lastEventId);

        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'x-request-id': req.id,
        });
        raw.write('retry: 3000\n: connected\n\n');

        let closed = false as boolean;
        let live = false;
        let sent = lastId ?? 0;
        const buffer: OutboxEvent[] = [];

        const push = (e: OutboxEvent): void => {
          if (closed || e.id <= sent) return;
          sent = e.id;
          if (belongsToOrg(e, actor.orgId)) raw.write(frame(e));
        };

        const unsubscribe = c.events.subscribe((e) => {
          if (live) push(e);
          else buffer.push(e);
        });
        const heartbeat = setInterval(() => {
          if (!closed) raw.write(': heartbeat\n\n');
        }, heartbeatMs);
        heartbeat.unref();

        const close = (): void => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          open.delete(close);
          if (!raw.writableEnded) raw.end();
        };
        open.add(close);
        raw.on('close', close);

        try {
          if (lastId !== null) {
            const [oldest, issued] = await Promise.all([oldestOutboxId(db), highestIssuedOutboxId(db)]);
            const firstAvailable = oldest ?? issued + 1;
            let replay: OutboxEvent[] = [];
            let reset = lastId > issued || lastId + 1 < firstAvailable;
            if (!reset) {
              replay = await outboxSince(db, lastId, maxReplay + 1);
              reset = replay.length > maxReplay;
            }
            if (reset) {
              const cursor = await latestOutboxId(db);
              sent = cursor;
              if (!closed) raw.write(`id: ${cursor}\nevent: reset\ndata: ${JSON.stringify({ cursor })}\n\n`);
            } else {
              for (const e of replay) push(e);
            }
          }
          live = true;
          for (const e of buffer.splice(0)) push(e);
        } catch (err) {
          req.log.error({ err }, 'sse replay failed');
          close();
        }
      },
    );
    done();
  };
}
