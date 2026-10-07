import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newRunToken, registerRunAuth, verifyRunToken } from '../../../execution/app/run-auth.ts';
import { openPolicy } from '../../../ports/testing.ts';
import { makeKit } from '../../../roles/worker.testkit.ts';
import { createDelegation, createGoalApproval, type RunContext } from '../index.ts';

type Kit = Awaited<ReturnType<typeof makeKit>>;
let kit: Kit;
let delegation: ReturnType<typeof createDelegation>;
let approval: ReturnType<typeof createGoalApproval>;

beforeEach(async () => {
  kit = await makeKit();
  delegation = createDelegation({
    ...kit.deps,
    tasks: kit.tasks,
    runs: kit.runs,
    agents: kit.agentUc,
    verifyRunToken,
  });
  approval = createGoalApproval({ ...kit.deps, tasks: kit.tasks, runs: kit.runs, policy: kit.policy });
});
afterEach(async () => {
  await kit.close();
});

async function setup(goalLimits?: Record<string, number>) {
  const acc = await kit.account('acc');
  const leader = await kit.agent('lead', acc.id, { role: 'leader' });
  const worker = await kit.agent('work', acc.id, { role: 'worker', labels: ['be'] });
  const policy = openPolicy({ canDelegate: true, maxMode: 'edit' });
  kit.policy.byAgent.set(leader.id, policy);
  const goal = await kit.tasks.createTask(kit.db, kit.actor, {
    title: 'Goal',
    prompt: 'Build it',
    workDir: '/work/repo',
    target: { agentId: leader.id },
    kind: 'goal',
    approval: 'required',
    ...(goalLimits && { goalLimits }),
  });
  const ctx = await leaderRun(goal.id, leader.id, acc.id);
  return { acc, leader, worker, goal, ctx };
}

async function leaderRun(taskId: string, agentId: string, accountId: string): Promise<RunContext> {
  const token = newRunToken();
  const run = await kit.db.transaction(async (tx) => {
    await kit.tasks.claimNextTask(tx, kit.dispatcher, 'w', {});
    const r = await kit.runs.startRun(tx, kit.dispatcher, {
      taskId,
      agentId,
      accountId,
      workerId: 'w',
      effectivePolicy: {
        ...openPolicy({ canDelegate: true, maxMode: 'edit' }),
        mode: 'read-only',
        plannedMode: 'edit',
      },
      skills: [],
    });
    await kit.tasks.setTaskStatus(tx, kit.dispatcher, taskId, 'running');
    await registerRunAuth(tx, {
      runId: r.id,
      orgId: kit.actor.orgId,
      agentId,
      workDir: '/work/repo',
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

async function endTurn(goalId: string, leaderId: string) {
  await kit.db.transaction(async (tx) => {
    await kit.tasks.setTaskStatus(tx, kit.dispatcher, goalId, 'done');
    await kit.tasks.endGoalTurn(tx, kit.dispatcher, goalId, { agentId: leaderId, sessionId: 'sess' });
  });
}
const goalState = (id: string) => kit.tasks.getGoalState(kit.db, kit.actor.orgId, id);
const claim = () => kit.db.transaction((tx) => kit.tasks.claimNextTask(tx, kit.dispatcher, 'w'));
const actions = () => kit.deps.audit.entries.map((e) => e.action);

describe('plan approval', () => {
  it('creates proposed drafts, keeps the planned mode, and waits for approval', async () => {
    const { ctx, goal, leader } = await setup();
    expect(ctx.mode).toBe('read-only');
    const a = await sub(ctx, { mode: 'full-auto' });
    const b = await sub(ctx, { dependsOn: [a.key] });
    expect(a).toMatchObject({ status: 'draft', mode: 'edit' });
    expect(b.dependsOn).toEqual([a.key]);
    expect(await kit.taskStatus(a.id)).toMatchObject({ proposed: true });
    expect(await claim()).toBeNull();
    await endTurn(goal.id, leader.id);
    expect((await goalState(goal.id))?.status).toBe('awaiting_approval');
  });

  it('goes to waiting when the leader proposed nothing', async () => {
    const { goal, leader } = await setup();
    await endTurn(goal.id, leader.id);
    expect((await goalState(goal.id))?.status).toBe('waiting');
  });

  it('approve queues the proposed drafts and moves the goal to waiting', async () => {
    const { ctx, goal, leader } = await setup();
    const a = await sub(ctx);
    await endTurn(goal.id, leader.id);
    await approval.approvePlan(kit.db, kit.actor, goal.id);
    expect((await goalState(goal.id))?.status).toBe('waiting');
    expect(await kit.taskStatus(a.id)).toMatchObject({ status: 'queued', proposed: true });
    expect((await claim())?.id).toBe(a.id);
    expect(actions()).toContain('goal.approve');
    await expect(approval.approvePlan(kit.db, kit.actor, goal.id)).rejects.toMatchObject({
      code: 'goal_not_awaiting_approval',
    });
  });

  it('approve with start-after-reset schedules the tasks', async () => {
    const { ctx, goal, leader } = await setup();
    const a = await sub(ctx);
    await endTurn(goal.id, leader.id);
    const at = new Date(Date.now() + 3_600_000);
    await approval.approvePlan(kit.db, kit.actor, goal.id, () => ({ runAt: at, afterReset: true }));
    expect(await kit.taskStatus(a.id)).toMatchObject({ status: 'scheduled', startAfterReset: true });
  });

  it('a plan can be edited, shrunk and extended before approval', async () => {
    const { ctx, goal, leader, worker } = await setup();
    const a = await sub(ctx);
    const b = await sub(ctx);
    await endTurn(goal.id, leader.id);
    await kit.tasks.updateDraft(kit.db, kit.actor, a.id, { title: 'Edited' });
    await kit.tasks.deleteDraft(kit.db, kit.actor, b.id);
    const added = await approval.addPlanTask(kit.db, kit.actor, goal.id, {
      title: 'Added',
      prompt: 'p',
      target: { agentId: worker.id },
      dependsOn: [a.id],
    });
    expect(added).toMatchObject({
      status: 'draft',
      proposed: true,
      workDir: '/work/repo',
      dependsOn: [a.id],
    });
    await expect(
      kit.tasks.updateDraft(kit.db, kit.actor, a.id, { workDir: '/elsewhere' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      approval.addPlanTask(kit.db, kit.actor, goal.id, {
        title: 'x',
        prompt: 'p',
        workDir: '/elsewhere',
        target: { agentId: worker.id },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await approval.approvePlan(kit.db, kit.actor, goal.id);
    expect((await kit.taskStatus(a.id))?.title).toBe('Edited');
  });

  it('approving an emptied plan is refused', async () => {
    const { ctx, goal, leader } = await setup();
    const a = await sub(ctx);
    await endTurn(goal.id, leader.id);
    await kit.tasks.deleteDraft(kit.db, kit.actor, a.id);
    await expect(approval.approvePlan(kit.db, kit.actor, goal.id)).rejects.toMatchObject({
      code: 'plan_empty',
    });
  });

  it('reject discards the plan and queues a new planning turn carrying the feedback', async () => {
    const { ctx, goal, leader } = await setup();
    const a = await sub(ctx, { title: 'Wrong approach' });
    await endTurn(goal.id, leader.id);
    const state = await approval.rejectPlan(kit.db, kit.actor, goal.id, 'Use the existing client instead');
    expect(state).toMatchObject({ status: 'continuing', round: 2, leaderSessionId: 'sess' });
    const task = await kit.taskStatus(goal.id);
    expect(task?.status).toBe('queued');
    expect(task?.prompt).toContain('Use the existing client instead');
    expect(task?.prompt).toContain('Wrong approach');
    expect(await kit.taskStatus(a.id)).toBeUndefined();
    expect(actions()).toContain('goal.reject');
    const entry = kit.deps.audit.entries.find((e) => e.action === 'goal.reject');
    expect(entry?.data).toMatchObject({ feedback: 'Use the existing client instead', round: 2 });
  });

  it('reject counts towards maxRounds and needs feedback', async () => {
    const { ctx, goal, leader } = await setup({ maxRounds: 1 });
    await sub(ctx);
    await endTurn(goal.id, leader.id);
    await expect(approval.rejectPlan(kit.db, kit.actor, goal.id, 'no')).rejects.toMatchObject({
      code: 'max_rounds',
    });
    await expect(approval.rejectPlan(kit.db, kit.actor, goal.id, '  ')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('requires task.write on the leader scope', async () => {
    const { ctx, goal, leader } = await setup();
    await sub(ctx);
    await endTurn(goal.id, leader.id);
    kit.deps.authorizer.deny = (action) => action === 'task.write';
    await expect(approval.approvePlan(kit.db, kit.actor, goal.id)).rejects.toMatchObject({ status: 403 });
    await expect(approval.rejectPlan(kit.db, kit.actor, goal.id, 'x')).rejects.toMatchObject({ status: 403 });
    expect((await goalState(goal.id))?.status).toBe('awaiting_approval');
  });
});
