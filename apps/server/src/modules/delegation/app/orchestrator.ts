import { sql } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { forbidden } from '../../../platform/errors.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { EffectivePolicySource, ModuleDeps } from '../../../ports/index.ts';
import type { createRuns } from '../../runs/index.ts';
import { terminalStatuses, type GoalState, type Task, type createTasks } from '../../tasks/index.ts';
import { buildContinuationPrompt } from '../domain/continuation.ts';
import { effectiveLimit } from '../domain/rules.ts';

export interface OrchestratorDeps extends ModuleDeps {
  tasks: ReturnType<typeof createTasks>;
  runs: Pick<ReturnType<typeof createRuns>, 'tokensByTask' | 'latestSessionId'>;
  policy: EffectivePolicySource;
}

export interface OrchestratorTick {
  /** False when another instance holds the leader lock. */
  leader: boolean;
  continued: number;
  failed: number;
  unrunnable: number;
  errors: number;
}

const LOCK_KEY = 'agent-band:goal-orchestrator';
const ACTIVE = ['planning', 'waiting', 'continuing'] as const;
const isTerminal = (t: Task): boolean => (terminalStatuses as readonly string[]).includes(t.status);

export function createOrchestrator(deps: OrchestratorDeps) {
  async function failGoal(tx: Tx, actor: ActorContext, goal: GoalState, root: Task, reason: string) {
    await deps.tasks.cancelOpenTreeTasks(tx, actor, goal.rootTaskId, reason, { includeRoot: true });
    await deps.tasks.updateGoalState(tx, goal.orgId, goal.rootTaskId, { status: 'failed', reason });
    // A finished leader turn leaves the goal task done; mark it failed so the board agrees.
    if (root.status === 'done') await deps.tasks.finishGoalTask(tx, actor, root.id, 'failed', reason);
    await deps.audit.append(tx, {
      orgId: goal.orgId,
      actorId: actor.principalId,
      action: 'goal.failed',
      targetType: 'task',
      targetId: goal.rootTaskId,
      data: { reason },
    });
  }

  /** Returns what happened to the goal in this pass. */
  async function processGoal(
    tx: Tx,
    actor: ActorContext,
    rootTaskId: string,
    counts: OrchestratorTick,
  ): Promise<'continued' | 'failed' | 'none'> {
    const goal = await deps.tasks.lockGoalState(tx, actor.orgId, rootTaskId);
    if (!goal || !(ACTIVE as readonly string[]).includes(goal.status)) return 'none';
    let tree = await deps.tasks.listTree(tx, actor.orgId, rootTaskId);
    const root = tree.find((t) => t.id === rootTaskId);
    if (!root) return 'none';

    const tokens = await deps.runs.tokensByTask(
      tx,
      actor,
      tree.map((t) => t.id),
    );
    const used = Object.values(tokens).reduce((a, b) => a + b, 0);
    if (used !== goal.treeTokensUsed)
      await deps.tasks.updateGoalState(tx, goal.orgId, rootTaskId, { treeTokensUsed: used });

    const policy = goal.leaderAgentId
      ? await deps.policy.forAgent(tx, goal.orgId, goal.leaderAgentId)
      : undefined;
    const budget = effectiveLimit(goal.limits.treeTokenBudget, policy?.treeTokenBudget);
    if (budget !== undefined && used >= budget) {
      await failGoal(tx, actor, goal, root, `tree token budget exceeded (${used} of ${budget})`);
      return 'failed';
    }
    if (goal.status !== 'waiting') return 'none';

    const cancelled = await deps.tasks.cancelUnrunnable(tx, actor, rootTaskId);
    counts.unrunnable += cancelled.length;
    if (cancelled.length > 0) tree = await deps.tasks.listTree(tx, actor.orgId, rootTaskId);
    const children = tree.filter((t) => t.id !== rootTaskId);
    if (children.some((t) => !isTerminal(t))) return 'none';

    const maxRounds = effectiveLimit(goal.limits.maxRounds, policy?.maxRounds) ?? goal.limits.maxRounds;
    if (goal.round >= maxRounds) {
      await failGoal(tx, actor, goal, root, `maxRounds (${maxRounds}) reached without completing the goal`);
      return 'failed';
    }

    const keys = new Map(tree.map((t) => [t.id, t.key]));
    const round = goal.round + 1;
    const prompt = buildContinuationPrompt({
      goalPrompt: goal.goalPrompt,
      round,
      maxRounds,
      children: children.map((t) => ({
        key: t.key,
        title: t.title,
        kind: t.kind,
        status: t.status,
        ...(t.result && { outcome: t.result.outcome, summary: t.result.summary }),
        ...(t.error && { error: t.error }),
        dependsOn: t.dependsOn.map((d) => keys.get(d) ?? d),
      })),
    });
    const sessionId = await deps.runs.latestSessionId(tx, actor, rootTaskId);
    await deps.tasks.updateGoalState(tx, goal.orgId, rootTaskId, {
      round,
      status: 'continuing',
      leaderSessionId: sessionId ?? goal.leaderSessionId,
    });
    await deps.tasks.requeueGoalTask(tx, actor, rootTaskId, prompt);
    await deps.audit.append(tx, {
      orgId: goal.orgId,
      actorId: actor.principalId,
      action: 'goal.continue',
      targetType: 'task',
      targetId: rootTaskId,
      data: { round, children: children.length },
    });
    return 'continued';
  }

  return {
    /** One orchestrator pass; does nothing unless this call holds the leader lock. */
    async tick(db: Db, actor: ActorContext): Promise<OrchestratorTick> {
      if (actor.kind !== 'system') throw forbidden('System actor required');
      const result: OrchestratorTick = { leader: false, continued: 0, failed: 0, unrunnable: 0, errors: 0 };
      await db.transaction(async (tx) => {
        const rows = (await tx.execute(
          sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as locked`,
        )) as { rows: { locked: boolean }[] };
        if (!rows.rows[0]?.locked) return;
        result.leader = true;
        const goals = await deps.tasks.listGoalStates(tx, actor.orgId, [...ACTIVE]);
        for (const g of goals) {
          try {
            // A savepoint keeps one broken goal from rolling back the whole pass.
            const outcome = await tx.transaction((sub) => processGoal(sub, actor, g.rootTaskId, result));
            if (outcome === 'continued') result.continued++;
            else if (outcome === 'failed') result.failed++;
          } catch {
            result.errors++;
          }
        }
      });
      return result;
    },
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
