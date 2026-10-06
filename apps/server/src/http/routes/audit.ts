import { Readable } from 'node:stream';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AuditExportQuery,
  AuditListDto,
  AuditQuery,
  AuditVerifyDto,
  AuditVerifyQuery,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';

export function auditRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  return (app, _opts, done) => {
    app.get(
      '/audit',
      {
        schema: {
          tags: ['audit'],
          summary: 'List audit events, newest first',
          querystring: AuditQuery,
          response: { 200: AuditListDto },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        const page = await c.audit.listAudit(db, await c.resolveActor(req), req.query);
        return { ...page, cursor };
      },
    );

    app.get(
      '/audit/verify',
      {
        schema: {
          tags: ['audit'],
          summary: 'Verify the hash chain, optionally over a seq range',
          querystring: AuditVerifyQuery,
          response: { 200: AuditVerifyDto },
        },
      },
      async (req) => c.audit.verifyAudit(db, await c.resolveActor(req), req.query),
    );

    app.get(
      '/audit/export',
      {
        schema: {
          tags: ['audit'],
          summary: 'Export audit events as JSON Lines (consistent snapshot up to toSeq)',
          querystring: AuditExportQuery,
        },
      },
      async (req, reply) => {
        const actor = await c.resolveActor(req);
        const iterator = c.audit.exportAudit(db, actor, req.query)[Symbol.asyncIterator]();
        // Authorization runs lazily inside the generator: pull the first item before sending headers.
        const first = await iterator.next();
        async function* lines(): AsyncGenerator<string> {
          if (first.done) return;
          yield first.value;
          for (;;) {
            const next = await iterator.next();
            if (next.done) return;
            yield next.value;
          }
        }
        return reply
          .type('application/x-ndjson; charset=utf-8')
          .header('content-disposition', 'attachment; filename="audit.jsonl"')
          .send(Readable.from(lines(), { objectMode: false }));
      },
    );
    done();
  };
}
