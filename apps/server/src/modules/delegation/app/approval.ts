import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, forbidden, invalid, notFound } from '../../../platform/errors.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { EffectivePolicySource, ModuleDeps } from '../../../ports/index.ts';
import { isPathWithin } from '../../policy/index.ts';
import type { createRuns } from '../../runs/index.ts';
import {
  taskResource,
  type CreateTaskInput,
  type GoalState,
  type StartPlan,
  type Task,
  type createTasks,
} from '../../tasks/index.ts';
import { buildRejectionPrompt } from '../domain/continuation.ts';
import { effectiveLimit } from '../domain/rules.ts';

export interface ApprovalDeps extends ModuleDeps {
  tasks: ReturnType<typeof createTasks>;
  runs: Pick<ReturnType<typeof createRuns>, 'latestSessionId'>;
  policy: EffectivePolicySource;
}

export type PlanTaskInput = Pick<
  CreateTaskInput,
  'title' | 'prompt' | 'workDir' | 'target' | 'priority' | 'mode' | 'maxAttempts'
> & { dependsOn?: string[] };

const FEEDBACK_MAX = 4000;

/** Human decisions on a goal's plan (approval required): approve, reject with feedback, extend the plan. */
export function createGoalApproval(deps: ApprovalDeps) {
  async function load(tx: Tx, actor: ActorContext, rootTaskId: string) {
    const tree = await deps.tasks.listTree(tx, actor.orgId, rootTaskId);
    const root = tree.find((t) => t.id === rootTaskId);
    if (!root || root.kind !== 'goal') throw notFound('goal');
    await deps.authorizer.authorize(tx, actor, 'task.write', taskResource(root.target));
    const goal = await deps.tasks.lockGoalState(tx, actor.orgId, rootTaskId);
    if (!goal) throw notFound('goal');
    if (goal.status !== 'awaiting_approval')
      throw conflict('goal_not_awaiting_approval', `Goal is ${goal.status}, not awaiting approval`);
    return { tree, root, goal };
  }

  async function audit(tx: Tx, actor: ActorContext, action: string, rootTaskId: string, data: unknown) {
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action,
      targetType: 'task',
      targetId: rootTaskId,
      data,
    });
  }

  return {
    async approvePlan(
      db: Db,
      actor: ActorContext,
      rootTaskId: string,
      planFor?: (t: Task) => StartPlan | undefined,
    ): Promise<GoalState> {
      return db.transaction(async (tx) => {
        await load(tx, actor, rootTaskId);
        const started = await deps.tasks.startProposed(tx, actor, rootTaskId, planFor);
        if (started.length === 0)
          throw conflict('plan_empty', 'The plan has no subtasks; add some or request changes');
        const goal = await deps.tasks.updateGoalState(tx, actor.orgId, rootTaskId, { status: 'waiting' });
        await audit(tx, actor, 'goal.approve', rootTaskId, { started: started.map((t) => t.key) });
        return goal;
      });
    },

    async rejectPlan(db: Db, actor: ActorContext, rootTaskId: string, feedback: string): Promise<GoalState> {
      const text = feedback.trim();
      if (text.length === 0 || text.length > FEEDBACK_MAX)
        throw invalid([{ path: 'feedback', message: `must be 1 to ${FEEDBACK_MAX} characters` }]);
      return db.transaction(async (tx) => {
        const { goal } = await load(tx, actor, rootTaskId);
        const policy = goal.leaderAgentId
          ? await deps.policy.forAgent(tx, goal.orgId, goal.leaderAgentId)
          : undefined;
        const maxRounds = effectiveLimit(goal.limits.maxRounds, policy?.maxRounds) ?? goal.limits.maxRounds;
        const round = goal.round + 1;
        if (round > maxRounds)
          throw conflict(
            'max_rounds',
            `maxRounds (${maxRounds}) reached; approve the plan or cancel the goal`,
          );
        const before = await deps.tasks.listTree(tx, actor.orgId, rootTaskId);
        const keys = new Map(before.map((t) => [t.id, t.key]));
        const discarded = await deps.tasks.deleteProposed(tx, actor, rootTaskId);
        const tree = await deps.tasks.listTree(tx, actor.orgId, rootTaskId);
        const prompt = buildRejectionPrompt({
          goalPrompt: goal.goalPrompt,
          round,
          maxRounds,
          feedback: text,
          rejected: discarded.map((t) => ({
            key: t.key,
            title: t.title,
            dependsOn: t.dependsOn.map((d) => keys.get(d) ?? d),
          })),
          children: tree
            .filter((t) => t.id !== rootTaskId)
            .map((t) => ({
              key: t.key,
              title: t.title,
              kind: t.kind,
              status: t.status,
              ...(t.result && { outcome: t.result.outcome, summary: t.result.summary }),
              dependsOn: t.dependsOn.map((d) => keys.get(d) ?? d),
            })),
        });
        const sessionId = await deps.runs.latestSessionId(tx, actor, rootTaskId);
        const updated = await deps.tasks.updateGoalState(tx, actor.orgId, rootTaskId, {
          round,
          status: 'continuing',
          leaderSessionId: sessionId ?? goal.leaderSessionId,
        });
        await deps.tasks.requeueGoalTurn(tx, actor, rootTaskId, prompt);
        await audit(tx, actor, 'goal.reject', rootTaskId, {
          round,
          discarded: discarded.length,
          feedback: text,
        });
        return updated;
      });
    },

    /** A human adds a subtask to the plan under review. */
    async addPlanTask(db: Db, actor: ActorContext, rootTaskId: string, input: PlanTaskInput): Promise<Task> {
      return db.transaction(async (tx) => {
        const { tree, root, goal } = await load(tx, actor, rootTaskId);
        const dir = input.workDir ?? root.workDir;
        if (!isPathWithin(dir, root.workDir))
          throw forbidden(`workDir ${dir} is outside the goal workDir ${root.workDir}`);
        await deps.authorizer.authorize(tx, actor, 'task.write', taskResource(input.target));
        const limit = goal.limits.maxSubtasks;
        if (tree.length - 1 >= limit) throw conflict('max_subtasks', `Subtask limit reached (${limit})`);
        const ids = new Set(tree.filter((t) => t.id !== rootTaskId).map((t) => t.id));
        const { dependsOn = [], workDir = root.workDir, ...rest } = input;
        if (dependsOn.some((d) => !ids.has(d)))
          throw invalid([{ path: 'dependsOn', message: 'must reference subtasks of this goal' }]);
        return deps.tasks.createChildTask(
          tx,
          actor,
          { ...rest, workDir },
          {
            kind: 'task',
            rootTaskId,
            parentTaskId: rootTaskId,
            depth: root.depth + 1,
            dependsOn,
            proposed: true,
          },
        );
      });
    },
  };
}

export type GoalApproval = ReturnType<typeof createGoalApproval>;
