import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newRunToken, registerRunAuth } from '../../../execution/app/run-auth.ts';
import { verifyRunToken } from '../../../execution/app/run-auth.ts';
import { openPolicy } from '../../../ports/testing.ts';
import { makeKit, waitFor } from '../../../roles/worker.testkit.ts';
import type { EffectivePolicy } from '../../policy/index.ts';
import type { Task } from '../../tasks/index.ts';
import { createDelegation, createOrchestrator, type RunContext } from '../index.ts';

type Kit = Awaited<ReturnType<typeof makeKit>>;
let kit: Kit;
let delegation: ReturnType<typeof createDelegation>;
let orchestrator: ReturnType<typeof createOrchestrator>;

beforeEach(async () => {
  kit = await makeKit();
  delegation = createDelegation({
    ...kit.deps,
    tasks: kit.tasks,
    runs: kit.runs,
    agents: kit.agentUc,
    verifyRunToken,
  });
  orchestrator = createOrchestrator({ ...kit.deps, tasks: kit.tasks, runs: kit.runs, policy: kit.policy });
});
afterEach(async () => {
  await kit.close();
});

const delegating = (extra: Partial<EffectivePolicy> = {}) =>
  openPolicy({ canDelegate: true, maxMode: 'edit', ...extra });

async function setup(opts: { policy?: Partial<EffectivePolicy>; goalLimits?: Record<string, number> } = {}) {
  const acc = await kit.account('acc');
  const leader = await kit.agent('lead', acc.id, { role: 'leader' });
  const worker = await kit.agent('work', acc.id, { role: 'worker', labels: ['be'] });
  const reviewer = await kit.agent('rev', acc.id, { role: 'reviewer' });
  const policy = delegating(opts.policy);
  kit.policy.byAgent.set(leader.id, policy);
  const goal = await kit.tasks.createTask(kit.db, kit.actor, {
    title: 'Goal',
    prompt: 'Build it',
    workDir: '/work/repo',
    target: { agentId: leader.id },
    kind: 'goal',
    ...(opts.goalLimits && { goalLimits: opts.goalLimits }),
  });
  const ctx = await startRun(goal, leader.id, acc.id, policy);
  return { acc, leader, worker, reviewer, goal, ctx, policy };
}

async function startRun(
  task: Task,
  agentId: string,
  accountId: string,
  policy: EffectivePolicy,
  claim = true,
): Promise<RunContext> {
  const token = newRunToken();
  const run = await kit.db.transaction(async (tx) => {
    if (claim) await kit.tasks.claimNextTask(tx, kit.dispatcher, 'w', {});
    const r = await kit.runs.startRun(tx, kit.dispatcher, {
      taskId: task.id,
      agentId,
      accountId,
      workerId: 'w',
      effectivePolicy: { ...policy, mode: 'edit' },
      skills: [],
    });
    await kit.tasks.setTaskStatus(tx, kit.dispatcher, task.id, 'running');
    await registerRunAuth(tx, {
      runId: r.id,
      orgId: kit.actor.orgId,
      agentId,
      workDir: task.workDir,
      token,
      policy: { deniedTools: [], workDirSets: [] },
    });
    return r;
  });
  return delegation.resolveRunContext(kit.db, run.id, token);
}

const sub = (ctx: RunContext, over: Record<string, unknown> = {}) =>
  delegation.createSubtask(kit.db, ctx, {
    title: 'Sub',
    prompt: 'Do it',
    workDir: '/work/repo/pkg',
    target: { label: 'be' },
    ...over,
  });

const claimAll = async () => {
  const out: Task[] = [];
  for (;;) {
    const t = await kit.db.transaction((tx) => kit.tasks.claimNextTask(tx, kit.dispatcher, 'w'));
    if (!t) return out;
    out.push(t);
  }
};

/** Moves a queued subtask to a terminal state with a result, as a worker would. */
async function complete(id: string, status: 'done' | 'failed', summary: string) {
  await kit.db.transaction(async (tx) => {
    const claimed = await kit.tasks.claimNextTask(tx, kit.dispatcher, 'w');
    if (claimed?.id !== id) throw new Error('unexpected claim order');
    await kit.tasks.setTaskStatus(tx, kit.dispatcher, id, 'running');
    await kit.tasks.setTaskStatus(tx, kit.dispatcher, id, status);
    await kit.tasks.recordResult(tx, kit.dispatcher, id, {
      summary,
      outcome: status === 'done' ? 'success' : 'failed',
    });
  });
}

const reject = async (p: Promise<unknown>, match: RegExp) => {
  const err = (await p.then(
    () => undefined,
    (e: unknown) => e,
  )) as { message?: string; details?: unknown } | undefined;
  expect(err, 'expected a rejection').toBeDefined();
  expect(`${err?.message ?? ''} ${JSON.stringify(err?.details ?? '')}`).toMatch(match);
};

describe('run context', () => {
  it('rejects a wrong token and an unknown run', async () => {
    const { ctx } = await setup();
    await expect(delegation.resolveRunContext(kit.db, ctx.runId, 'nope')).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      delegation.resolveRunContext(kit.db, crypto.randomUUID(), newRunToken()),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('exposes the run, task, agent and policy', async () => {
    const { ctx, leader, goal } = await setup();
    expect(ctx).toMatchObject({ leaderAgentId: leader.id, rootTaskId: goal.id, mode: 'edit' });
    expect(ctx.policy.canDelegate).toBe(true);
    expect(ctx.actor).toMatchObject({ principalId: leader.id, kind: 'agent' });
  });
});

describe('createSubtask', () => {
  it('creates a linked subtask and returns its key', async () => {
    const { ctx, goal, leader } = await setup();
    const view = await sub(ctx, { priority: 1 });
    expect(view).toMatchObject({ status: 'queued', kind: 'task', mode: 'edit', dependsOn: [] });
    const task = await kit.taskStatus(view.id);
    expect(task).toMatchObject({
      parentTaskId: goal.id,
      rootTaskId: goal.id,
      depth: 1,
      createdBy: leader.id,
      priority: 1,
    });
    expect((await delegation.listSubtasks(kit.db, ctx)).map((s) => s.key)).toEqual([view.key]);
    expect((await delegation.getTask(kit.db, ctx, view.key)).id).toBe(view.id);
  });

  it('rejects when canDelegate is not granted', async () => {
    const { ctx } = await setup({ policy: { canDelegate: undefined } });
    await reject(sub(ctx), /not allowed by policy/);
    await reject(delegation.listDelegateAgents(kit.db, ctx), /not allowed by policy/);
  });

  it('rejects a target outside delegateTargets, including a label that resolves outside', async () => {
    const { ctx, worker, acc } = await setup({ policy: { delegateTargets: { agentIds: [] } } });
    await reject(sub(ctx, { target: { agentId: worker.id } }), /outside the allowed/);
    await reject(sub(ctx), /outside the allowed/);
    expect(acc.id).toBeTruthy();
  });

  it('rejects a label target whose agents lack an allowed label', async () => {
    const { ctx } = await setup({ policy: { delegateTargets: { labels: ['zzz'] } } });
    await reject(sub(ctx), /outside the allowed/);
  });

  it('accepts a target inside delegateTargets', async () => {
    const { ctx, worker } = await setup();
    kit.policy.byAgent.set(ctx.leaderAgentId, delegating({ delegateTargets: { agentIds: [worker.id] } }));
    const ctx2 = { ...ctx, policy: delegating({ delegateTargets: { agentIds: [worker.id] } }) };
    expect((await sub(ctx2, { target: { agentId: worker.id } })).status).toBe('queued');
  });

  it('refuses leaders and the leader itself as targets, and unknown targets', async () => {
    const { ctx, leader } = await setup();
    await reject(sub(ctx, { target: { agentId: leader.id } }), /cannot receive/);
    await reject(sub(ctx, { target: { agentId: crypto.randomUUID() } }), /not found/);
  });

  it('rejects a workDir outside the goal workDir', async () => {
    const { ctx } = await setup();
    await reject(sub(ctx, { workDir: '/work/other' }), /outside the goal workDir/);
    await reject(sub(ctx, { workDir: '/work/repo/../other' }), /outside the goal workDir/);
    expect((await sub(ctx, { workDir: '/work/repo' })).workDir).toBe('/work/repo');
  });

  it('caps the mode at the leader maxMode and never widens it', async () => {
    const { ctx } = await setup();
    expect((await sub(ctx, { mode: 'full-auto' })).mode).toBe('edit');
    expect((await sub(ctx, { mode: 'read-only' })).mode).toBe('read-only');
    expect((await sub(ctx)).mode).toBe('edit');
  });

  it('enforces maxSubtasks from the goal limits and the policy', async () => {
    const a = await setup({ goalLimits: { maxSubtasks: 2 } });
    await sub(a.ctx);
    await sub(a.ctx);
    await reject(sub(a.ctx), /Subtask limit reached \(2\)/);
  });

  it('enforces the policy maxSubtasks when lower than the goal limit', async () => {
    const a = await setup({ policy: { maxSubtasks: 1 } });
    await sub(a.ctx);
    await reject(sub(a.ctx), /Subtask limit reached \(1\)/);
  });

  it('refuses delegation from a subtask run (maxDepth 1)', async () => {
    const { ctx, worker, acc } = await setup();
    const child = await sub(ctx);
    const childTask = (await kit.taskStatus(child.id)) as Task;
    const childCtx = await startRun(childTask, worker.id, acc.id, delegating());
    await reject(sub(childCtx), /cannot delegate further/);
    await reject(
      delegation.completeGoal(kit.db, childCtx, { summary: 's', outcome: 'success' }),
      /only the goal leader/,
    );
  });

  it('keeps dependsOn inside the tree and rejects unknown references', async () => {
    const a = await setup();
    const first = await sub(a.ctx);
    const second = await sub(a.ctx, { dependsOn: [first.key] });
    expect(second.dependsOn).toEqual([first.key]);
    await reject(sub(a.ctx, { dependsOn: ['NOPE-1'] }), /not a subtask of this goal/);
    await reject(sub(a.ctx, { dependsOn: [a.goal.key] }), /not a subtask of this goal/);
    const foreign = await kit.task({ target: { label: 'x' } });
    await reject(sub(a.ctx, { dependsOn: [foreign.key] }), /not a subtask of this goal/);
  });

  it('rejects after the goal is completed', async () => {
    const { ctx } = await setup();
    await delegation.completeGoal(kit.db, ctx, { summary: 'done', outcome: 'success' });
    await reject(sub(ctx), /Goal is completed/);
  });

  it('rejects when the tree token budget is exhausted', async () => {
    const { ctx, acc, worker, goal } = await setup({ goalLimits: { treeTokenBudget: 100 } });
    await spend(goal.id, worker.id, acc.id, 150);
    await reject(sub(ctx), /budget exhausted/);
  });

  it('validates input', async () => {
    const { ctx } = await setup();
    await expect(sub(ctx, { workDir: 'relative' })).rejects.toMatchObject({ status: 400 });
    await expect(sub(ctx, { unknown: 1 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('dependency gating', () => {
  it('does not claim a task before its dependencies are done', async () => {
    const { ctx } = await setup();
    const a = await sub(ctx);
    const b = await sub(ctx, { dependsOn: [a.key] });
    const first = await claimAll();
    expect(first.map((t) => t.id)).toEqual([expect.any(String)]);
    expect(first[0]?.id).toBe(a.id);
    await kit.db.transaction(async (tx) => {
      await kit.tasks.setTaskStatus(tx, kit.dispatcher, a.id, 'running');
      await kit.tasks.setTaskStatus(tx, kit.dispatcher, a.id, 'done');
    });
    expect((await claimAll()).map((t) => t.id)).toEqual([b.id]);
  });

  it('cancels tasks whose dependency failed so the goal can move on', async () => {
    const { ctx, goal } = await setup();
    const a = await sub(ctx);
    const b = await sub(ctx, { dependsOn: [a.key] });
    await complete(a.id, 'failed', 'boom');
    await endTurn(ctx);
    const tick = await orchestrator.tick(kit.db, kit.dispatcher);
    expect(tick.unrunnable).toBe(1);
    expect((await kit.taskStatus(b.id))?.status).toBe('cancelled');
    expect((await kit.taskStatus(b.id))?.error).toContain('failed');
    expect(tick.continued).toBe(1);
    expect(goal.id).toBeTruthy();
  });
});

describe('review, notes and completion', () => {
  it('creates a read-only review subtask for a reviewer after the subtask is done', async () => {
    const { ctx, reviewer, worker } = await setup();
    const a = await sub(ctx);
    await reject(
      delegation.requestReview(kit.db, ctx, {
        subtaskKey: a.key,
        reviewerTarget: { agentId: reviewer.id },
        instructions: 'check',
      }),
      /not done/,
    );
    await complete(a.id, 'done', 'implemented X');
    await reject(
      delegation.requestReview(kit.db, ctx, {
        subtaskKey: a.key,
        reviewerTarget: { agentId: worker.id },
        instructions: 'check',
      }),
      /cannot receive/,
    );
    const review = await delegation.requestReview(kit.db, ctx, {
      subtaskKey: a.key,
      reviewerTarget: { agentId: reviewer.id },
      instructions: 'check the tests',
    });
    expect(review).toMatchObject({ kind: 'review', mode: 'read-only', dependsOn: [a.key] });
    const task = (await kit.taskStatus(review.id)) as Task;
    expect(task.prompt).toContain('implemented X');
    expect(task.prompt).toContain('check the tests');
  });

  it('completeGoal finishes the goal, cancels open subtasks and stores the result', async () => {
    const { ctx, goal } = await setup();
    const open = await sub(ctx);
    const out = await delegation.completeGoal(kit.db, ctx, { summary: 'All good', outcome: 'success' });
    expect(out).toEqual({ status: 'completed', cancelledSubtasks: [open.key] });
    const state = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
    expect(state).toMatchObject({ status: 'completed', summary: 'All good', outcome: 'success' });
    expect((await kit.taskStatus(open.id))?.status).toBe('cancelled');
    expect((await kit.taskStatus(goal.id))?.result).toEqual({ summary: 'All good', outcome: 'success' });
    await reject(
      delegation.completeGoal(kit.db, ctx, { summary: 'x', outcome: 'success' }),
      /Goal is completed/,
    );
  });

  it('a failed outcome marks the goal failed', async () => {
    const { ctx, goal } = await setup();
    await delegation.completeGoal(kit.db, ctx, { summary: 'nope', outcome: 'failed' });
    expect((await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id))?.status).toBe('failed');
  });

  it('posts notes to the goal timeline', async () => {
    const { ctx, goal } = await setup();
    await delegation.postNote(kit.db, ctx, 'plan: split in two');
    const state = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
    expect(state?.notes).toMatchObject([{ text: 'plan: split in two', runId: ctx.runId }]);
    await expect(delegation.postNote(kit.db, ctx, '  ')).rejects.toMatchObject({ status: 400 });
  });

  it('lists only delegable agents', async () => {
    const { ctx, worker, reviewer } = await setup();
    const all = await delegation.listDelegateAgents(kit.db, ctx);
    expect(all.map((a) => a.id).sort()).toEqual([worker.id, reviewer.id].sort());
    expect(await delegation.listDelegateAgents(kit.db, ctx, { role: 'reviewer' })).toHaveLength(1);
    expect(JSON.stringify(all)).not.toMatch(/accountId|systemPrompt/);
  });
});

describe('audit', () => {
  it('attributes every call to the leader and records denials', async () => {
    const { ctx, leader } = await setup({ goalLimits: { maxSubtasks: 1 } });
    const a = await sub(ctx);
    await delegation.listDelegateAgents(kit.db, ctx);
    await delegation.listSubtasks(kit.db, ctx);
    await delegation.getTask(kit.db, ctx, a.key);
    await delegation.postNote(kit.db, ctx, 'n');
    await reject(sub(ctx), /limit/);
    await delegation.completeGoal(kit.db, ctx, { summary: 's', outcome: 'partial' });
    const entries = kit.deps.audit.entries.filter((e) => e.action.startsWith('delegation.'));
    expect(entries.map((e) => e.action)).toEqual([
      'delegation.create_subtask',
      'delegation.list_agents',
      'delegation.list_subtasks',
      'delegation.get_task',
      'delegation.note',
      'delegation.denied',
      'delegation.complete_goal',
    ]);
    for (const e of entries) expect(e.actorId).toBe(leader.id);
    expect(entries.find((e) => e.action === 'delegation.denied')?.data).toMatchObject({
      attempted: 'delegation.create_subtask',
      code: 'max_subtasks',
    });
  });
});

/** Gives a task a finished run that used `tokens` tokens. */
async function spend(taskId: string, agentId: string, accountId: string, tokens: number) {
  await kit.db.transaction(async (tx) => {
    const r = await kit.runs.startRun(tx, kit.dispatcher, {
      taskId,
      agentId,
      accountId,
      workerId: 'w',
      effectivePolicy: {},
      skills: [],
    });
    await kit.runs.appendRunEvent(tx, kit.dispatcher, r.id, {
      kind: 'usage',
      inputTokens: tokens - 10,
      outputTokens: 10,
      cachedTokens: 0,
    });
    await kit.runs.finishRun(tx, kit.dispatcher, r.id, { status: 'done', exitCode: 0 });
  });
}

/** Ends the leader's turn the way the worker does. */
async function endTurn(ctx: RunContext, sessionId?: string) {
  await kit.db.transaction(async (tx) => {
    await kit.runs.finishRun(tx, kit.dispatcher, ctx.runId, { status: 'done', exitCode: 0 });
    await kit.tasks.setTaskStatus(tx, kit.dispatcher, ctx.rootTaskId, 'done');
    await kit.tasks.endGoalTurn(tx, kit.dispatcher, ctx.rootTaskId, {
      agentId: ctx.leaderAgentId,
      ...(sessionId && { sessionId }),
    });
  });
}

describe('orchestrator', () => {
  it('waits for open subtasks, then queues a continuation with the child results', async () => {
    const { ctx, goal } = await setup();
    const a = await sub(ctx, { title: 'Build API' });
    const b = await sub(ctx, { title: 'Write docs' });
    await kit.db.transaction((tx) =>
      kit.runs.appendRunEvent(tx, kit.dispatcher, ctx.runId, { kind: 'session', sessionId: 'sess-1' }),
    );
    await endTurn(ctx);
    expect((await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id))?.status).toBe('waiting');

    // The leader's task is done, so only the subtasks are claimable.
    await complete(a.id, 'done', 'API built');
    let tick = await orchestrator.tick(kit.db, kit.dispatcher);
    expect(tick).toMatchObject({ leader: true, continued: 0 });
    await complete(b.id, 'failed', 'docs failed');

    tick = await orchestrator.tick(kit.db, kit.dispatcher);
    expect(tick.continued).toBe(1);
    const state = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
    expect(state).toMatchObject({ status: 'continuing', round: 2, leaderSessionId: 'sess-1' });
    const root = (await kit.taskStatus(goal.id)) as Task;
    expect(root.status).toBe('queued');
    expect(root.prompt).toContain('Build it');
    expect(root.prompt).toContain(`[${a.key}] Build API`);
    expect(root.prompt).toContain('summary: API built');
    expect(root.prompt).toContain('outcome: failed');
    expect(root.prompt).toContain('turn 2');

    expect((await orchestrator.tick(kit.db, kit.dispatcher)).continued).toBe(0);
  });

  it('fails the goal when maxRounds is reached', async () => {
    const { ctx, goal } = await setup({ goalLimits: { maxRounds: 1 } });
    await sub(ctx);
    await endTurn(ctx);
    const [a] = await claimAll();
    await kit.db.transaction(async (tx) => {
      await kit.tasks.setTaskStatus(tx, kit.dispatcher, a?.id ?? '', 'running');
      await kit.tasks.setTaskStatus(tx, kit.dispatcher, a?.id ?? '', 'done');
    });
    const tick = await orchestrator.tick(kit.db, kit.dispatcher);
    expect(tick.failed).toBe(1);
    expect(await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id)).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('maxRounds (1)') as unknown,
    });
    expect(await kit.taskStatus(goal.id)).toMatchObject({ status: 'failed' });
  });

  it('applies the leader policy maxRounds when lower', async () => {
    const { ctx, goal } = await setup({ policy: { maxRounds: 1 } });
    await endTurn(ctx);
    expect((await orchestrator.tick(kit.db, kit.dispatcher)).failed).toBe(1);
    expect((await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id))?.reason).toContain(
      'maxRounds (1)',
    );
  });

  it('cancels open subtasks and fails the goal when the tree budget is exceeded', async () => {
    const { ctx, goal, worker, acc } = await setup({ goalLimits: { treeTokenBudget: 1000 } });
    const a = await sub(ctx);
    const b = await sub(ctx);
    await spend(a.id, worker.id, acc.id, 600);
    expect((await orchestrator.tick(kit.db, kit.dispatcher)).failed).toBe(0);
    expect((await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id))?.treeTokensUsed).toBe(600);
    await spend(b.id, worker.id, acc.id, 500);
    const tick = await orchestrator.tick(kit.db, kit.dispatcher);
    expect(tick.failed).toBe(1);
    const state = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
    expect(state).toMatchObject({ status: 'failed', treeTokensUsed: 1100 });
    expect(state?.reason).toContain('tree token budget exceeded (1100 of 1000)');
    expect((await kit.taskStatus(a.id))?.status).toBe('cancelled');
    expect((await kit.taskStatus(b.id))?.status).toBe('cancelled');
    expect((await kit.taskStatus(goal.id))?.status).toBe('cancelled');
  });

  it('cancelling the goal task fails the goal and cancels its subtasks', async () => {
    const { ctx, goal } = await setup();
    const a = await sub(ctx);
    await kit.tasks.cancelTask(kit.db, kit.actor, goal.id);
    expect((await kit.taskStatus(a.id))?.status).toBe('cancelled');
    expect((await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id))?.status).toBe('failed');
  });

  it('does nothing for completed goals and runs one leader at a time', async () => {
    const { ctx } = await setup();
    await delegation.completeGoal(kit.db, ctx, { summary: 's', outcome: 'success' });
    await endTurn(ctx);
    expect(await orchestrator.tick(kit.db, kit.dispatcher)).toMatchObject({ continued: 0, failed: 0 });
    await expect(orchestrator.tick(kit.db, kit.actor)).rejects.toMatchObject({ status: 403 });
    await waitFor(() => Promise.resolve(true));
  });
});
