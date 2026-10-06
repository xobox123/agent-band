import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createComposition, type CompositionOptions } from './composition.ts';
import { openDatabase } from './platform/db.ts';
import type { Config } from './platform/config.ts';
import { startAll } from './roles/all.ts';
import { startApi } from './roles/api.ts';
import type { RoleHandle } from './roles/types.ts';
import { startWorker } from './roles/worker-hook.ts';

export interface RunningServer extends RoleHandle {
  /** Bound HTTP port; undefined for the worker-only role. */
  port?: number;
}

export interface StartOptions {
  webDist?: string;
  resolveActor?: CompositionOptions['resolveActor'];
}

/** Opens the database, wires the composition root and starts the configured role. */
export async function start(config: Config, opts: StartOptions = {}): Promise<RunningServer> {
  mkdirSync(config.home, { recursive: true, mode: 0o700 });
  const database = await openDatabase({
    databaseUrl: config.databaseUrl,
    pgliteDir: config.databaseUrl ? undefined : (config.pgliteDir ?? join(config.home, 'pgdata')),
  });

  let role: RoleHandle & { port?: number };
  try {
    const composition = await createComposition({
      database,
      home: config.home,
      resolveActor: opts.resolveActor,
    });
    if (config.role === 'api') {
      role = await startApi(config, composition, opts);
    } else if (config.role === 'all') {
      const all = await startAll(config, composition, opts);
      role = { stop: () => all.stop(), port: all.api.port };
    } else {
      await composition.events.start();
      const worker = await startWorker(composition);
      if (!worker) throw new Error('The worker role is not available yet');
      role = {
        async stop() {
          await worker.stop();
          await composition.events.stop();
        },
      };
    }
  } catch (err) {
    await database.close();
    throw err;
  }

  let stopped: Promise<void> | undefined;
  return {
    port: role.port,
    stop() {
      stopped ??= role.stop().finally(() => database.close());
      return stopped;
    },
  };
}
