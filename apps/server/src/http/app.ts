import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponse } from '@agent-band/contracts';
import type { Database } from '../platform/db.ts';
import { registerPlatform } from '../platform/http.ts';

export interface AppOptions {
  logger?: boolean | { level: string };
  database?: Database;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  registerPlatform(app, { database: options.database });

  app.get('/healthz', () => HealthResponse.parse({ status: 'ok' }));

  return app;
}
