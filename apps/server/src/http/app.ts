import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponse } from '@agent-band/contracts';
import type { Composition } from '../composition.ts';
import type { Database } from '../platform/db.ts';
import { registerPlatform } from '../platform/http.ts';
import { registerApiRoutes } from './routes/index.ts';
import type { SseOptions } from './routes/events.ts';
import { registerStatic } from './static.ts';

export interface AppOptions {
  logger?: boolean | { level: string };
  database?: Database;
  /** When set, the REST API and SSE are registered. */
  composition?: Composition;
  /** Directory with the built web app; served with SPA fallback when it exists. */
  webDist?: string;
  sse?: SseOptions;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    forceCloseConnections: true,
    bodyLimit: 16 * 1024 * 1024,
  });

  registerPlatform(app, { database: options.database ?? options.composition?.database });

  app.get('/healthz', () => HealthResponse.parse({ status: 'ok' }));

  if (options.composition) {
    const composition = options.composition;
    void app.register(async (instance) => {
      await registerApiRoutes(instance, composition, options.sse);
    });
  }
  if (options.webDist) registerStatic(app, options.webDist);

  return app;
}
