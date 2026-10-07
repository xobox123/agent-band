import type { StartWhen } from '@agent-band/contracts';
import type { ActorContext } from '../platform/actor.ts';
import { invalid } from '../platform/errors.ts';
import type { StartPlan, Task } from '../modules/tasks/index.ts';
import type { Composition } from '../composition.ts';

type PlanFor = (t: Task) => StartPlan | undefined;

/** Next reset of the window limiting an account: an explicit block first, else the fullest window. */
async function accountReset(c: Composition, actor: ActorContext, accountId: string, now: Date) {
  const db = c.database.db;
  const blocked = await c.usage.accountBlock(db, actor, accountId, now);
  if (blocked) return blocked;
  const windows = (await c.usage.latestWindows(db, actor, accountId))
    .filter((w) => w.resetsAt && Date.parse(w.resetsAt) > now.getTime())
    .sort((a, b) => b.usedPercent - a.usedPercent);
  const first = windows[0];
  return first?.resetsAt ? new Date(first.resetsAt) : null;
}

async function candidateAccounts(c: Composition, actor: ActorContext, task: Task): Promise<string[]> {
  const db = c.database.db;
  const t = task.target;
  const agents =
    'agentId' in t
      ? [await c.agents.getAgent(db, actor, t.agentId).catch(() => undefined)].flatMap((a) => a ?? [])
      : 'label' in t
        ? await c.agents.listAgents(db, actor, { label: t.label })
        : await c.agents.listAgents(db, actor, { groupId: t.agentGroupId });
  return [...new Set(agents.map((a) => a.accountId))];
}

/** Resolves a "start when" choice to per-task start times. Without a usage snapshot it means now. */
export async function planStart(
  c: Composition,
  actor: ActorContext,
  tasks: Task[],
  when: StartWhen,
  now = new Date(),
): Promise<PlanFor> {
  if (when.mode === 'now') return () => undefined;
  if (when.mode === 'at') {
    const at = new Date(when.at);
    if (at.getTime() <= now.getTime()) throw invalid([{ path: 'when.at', message: 'must be in the future' }]);
    return () => ({ runAt: at });
  }
  const plans = new Map<string, StartPlan>();
  for (const task of tasks) {
    const resets: Date[] = [];
    for (const accountId of await candidateAccounts(c, actor, task)) {
      const reset = await accountReset(c, actor, accountId, now);
      if (reset) resets.push(reset);
    }
    const earliest = resets.sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) plans.set(task.id, { runAt: earliest, afterReset: true });
  }
  return (t) => plans.get(t.id);
}
