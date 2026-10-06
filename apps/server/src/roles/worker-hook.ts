import type { Composition } from '../composition.ts';
import type { RoleHandle } from './types.ts';

/**
 * Hook point for the worker (T9). The T9 merge replaces this body with
 * `startWorker(composition)` from `roles/worker.ts`. Returns null while no worker exists.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function startWorker(_composition: Composition): Promise<RoleHandle | null> {
  return Promise.resolve(null);
}
