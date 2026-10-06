import type { Composition } from '../composition.ts';
import type { RoleHandle } from './types.ts';

/**
 * Hook point for the worker (T9). The T9 merge replaces this body with
 * `startWorker(composition)` from `roles/worker.ts`. Returns null while no worker exists.
 */
export function startWorker(composition: Composition): Promise<RoleHandle | null> {
  void composition;
  return Promise.resolve(null);
}
