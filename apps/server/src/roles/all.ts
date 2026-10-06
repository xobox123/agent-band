import type { Composition } from '../composition.ts';
import type { Config } from '../platform/config.ts';
import { startApi, type ApiHandle } from './api.ts';
import type { RoleHandle } from './types.ts';
import { startWorker, type WorkerHandle } from './worker-hook.ts';

export interface AllHandle extends RoleHandle {
  api: ApiHandle;
  worker: WorkerHandle;
}

/** API and worker in one process (local mode). */
export async function startAll(
  config: Pick<Config, 'port' | 'logLevel' | 'workerSlots' | 'workerId'> & { schedulerIntervalMs?: number },
  composition: Composition,
  opts: { webDist?: string } = {},
): Promise<AllHandle> {
  const api = await startApi(config, composition, opts);
  let worker: WorkerHandle;
  try {
    worker = await startWorker(composition, config);
  } catch (err) {
    await api.stop();
    throw err;
  }
  return {
    api,
    worker,
    async stop() {
      // Stop claiming first, then the API, so finishing runs can still publish events.
      await worker.stop();
      await api.stop();
    },
  };
}
