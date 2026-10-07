import type { TaskTarget } from '@agent-band/contracts';
import type { ActorContext } from '../platform/actor.ts';
import { unprocessable } from '../platform/errors.ts';
import { isPathAllowed } from '../modules/policy/index.ts';
import type { Composition } from '../composition.ts';

/**
 * Rejects an explicit work directory the target agent's effective policy would deny at run start.
 * Only agent targets are checked; labels and groups are evaluated per candidate when the task runs.
 */
export async function assertWorkDirAllowed(
  c: Composition,
  actor: ActorContext,
  target: TaskTarget,
  workDir: string,
): Promise<void> {
  if (!('agentId' in target)) return;
  const agent = await c.agents.getAgent(c.database.db, actor, target.agentId).catch(() => undefined);
  if (!agent) return;
  const policy = await c.policies.effectiveFor(actor.orgId, agent.id);
  if (isPathAllowed(workDir, policy.workDirSets)) return;
  const message = `Folder ${workDir} is outside the directories allowed for ${agent.name}.`;
  throw unprocessable('work_dir_outside_policy', message, [{ path: 'workDir', message }]);
}
