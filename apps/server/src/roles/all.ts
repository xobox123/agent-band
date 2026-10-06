import type { Composition } from '../composition.ts';
import type { Config } from '../platform/config.ts';
import { startApi, type ApiHandle } from './api.ts';
import type { RoleHandle } from './types.ts';
import { startWorker } from './worker-hook.ts';

export interface AllHandle extends RoleHandle {
  api: ApiHandle;
}

/** API and worker in one process (local mode). */
export async function startAll(
  config: Pick<Config, 'port' | 'logLevel'>,
  composition: Composition,
  opts: { webDist?: string } = {},
): Promise<AllHandle> {
  const api = await startApi(config, composition, opts);
  let worker: RoleHandle | null = null;
  try {
    worker = await startWorker(composition);
  } catch (err) {
    await api.stop();
    throw err;
  }
  return {
    api,
    async stop() {
      // Stop claiming first, then the API, so finishing runs can still publish events.
      await worker?.stop();
      await api.stop();
    },
  };
}
