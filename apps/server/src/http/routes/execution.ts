import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuthorizeToolRequest, AuthorizeToolResponse, RUN_TOKEN_HEADER } from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { createAuthorizeToolCall } from '../../execution/index.ts';

/** Called by the tool-gate hook of a running agent; authenticated by the run token only. */
export function executionRoutes(c: Composition): FastifyPluginCallbackZod {
  const authorize = createAuthorizeToolCall({ audit: c.ports.audit, runs: c.runs });
  return (app, _opts, done) => {
    app.post(
      '/runs/:runId/authorize-tool',
      {
        schema: {
          tags: ['execution'],
          summary: 'Authorize one tool call of a running agent',
          params: z.object({ runId: z.uuid() }),
          body: AuthorizeToolRequest,
          response: { 200: AuthorizeToolResponse },
        },
      },
      async (req) => {
        const header = req.headers[RUN_TOKEN_HEADER];
        const token = typeof header === 'string' ? header : '';
        if (!token) return { decision: 'deny' as const, reason: 'missing run token' };
        return authorize(c.database.db, req.params.runId, token, req.body);
      },
    );
    done();
  };
}
