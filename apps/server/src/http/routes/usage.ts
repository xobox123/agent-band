import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { DashboardDto } from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { buildDashboard } from '../dashboard.ts';

export function usageRoutes(c: Composition): FastifyPluginCallbackZod {
  return (app, _opts, done) => {
    app.get(
      '/dashboard',
      {
        schema: {
          tags: ['usage'],
          summary: 'Accounts with limit windows, agents with status, running runs, queue size',
          response: { 200: DashboardDto },
        },
      },
      async (req) => buildDashboard(c, await c.resolveActor(req)),
    );
    done();
  };
}
