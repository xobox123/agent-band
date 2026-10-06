import { hostname } from 'node:os';
import type { Composition } from '../composition.ts';
import type { Config } from '../platform/config.ts';
import {
  createEffectivePolicySource,
  createEffectiveSkillsSource,
  createWorker,
  defaultAdapterFor,
  type Worker,
} from '../execution/index.ts';
import type { RoleHandle } from './types.ts';

export interface WorkerHandle extends RoleHandle {
  worker: Worker;
}

/** Builds the worker from the composition root and starts claiming tasks. */
export async function startWorker(
  composition: Composition,
  config: Pick<Config, 'port' | 'workerSlots' | 'workerId'>,
): Promise<WorkerHandle> {
  const worker = createWorker({
    db: composition.database.db,
    dispatcher: composition.dispatcher,
    workerId: config.workerId ?? `${hostname()}-${process.pid}`,
    slots: config.workerSlots,
    apiPort: config.port,
    events: composition.events,
    audit: composition.ports.audit,
    tasks: composition.tasks,
    runs: composition.runs,
    usage: composition.usage,
    agents: composition.agents,
    accounts: composition.accounts,
    policy: createEffectivePolicySource({ bindings: composition.ports.policyBindings }),
    skills: createEffectiveSkillsSource({ membership: composition.ports.agentMembership }),
    adapterFor: defaultAdapterFor,
  });
  await worker.start();
  return {
    worker,
    stop: () => worker.stop(),
  };
}
