import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../http/app.ts';
import type { Composition } from '../composition.ts';
import type { Config } from '../platform/config.ts';
import { pruneOutbox } from '../platform/outbox.ts';
import type { RoleHandle } from './types.ts';

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const defaultWebDist = fileURLToPath(new URL('../../../web/dist', import.meta.url));

export interface ApiHandle extends RoleHandle {
  app: FastifyInstance;
  port: number;
}

export async function startApi(
  config: Pick<Config, 'port' | 'logLevel'>,
  composition: Composition,
  opts: { webDist?: string } = {},
): Promise<ApiHandle> {
  const app = buildApp({
    logger: { level: config.logLevel },
    composition,
    webDist: opts.webDist ?? defaultWebDist,
  });
  await composition.events.start();

  const prune = (): void => {
    pruneOutbox(composition.database.db).catch((err: unknown) => {
      app.log.error({ err }, 'outbox retention cleanup failed');
    });
  };
  prune();
  const timer = setInterval(prune, PRUNE_INTERVAL_MS);
  timer.unref();

  try {
    await app.listen({ host: '127.0.0.1', port: config.port });
  } catch (err) {
    clearInterval(timer);
    await composition.events.stop();
    await app.close();
    throw err;
  }
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    app,
    port,
    async stop() {
      clearInterval(timer);
      await app.close();
      await composition.events.stop();
    },
  };
}
