import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponse } from '@agent-band/contracts';

export interface AppOptions {
  logger?: boolean | { level: string };
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/healthz', () => HealthResponse.parse({ status: 'ok' }));

  return app;
}
