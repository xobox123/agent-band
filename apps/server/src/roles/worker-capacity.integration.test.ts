import { eq } from 'drizzle-orm';
import { tasks as tasksTable } from '../modules/tasks/infra/schema.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeKit, waitFor } from './worker.testkit.ts';

type Kit = Awaited<ReturnType<typeof makeKit>>;
let kit: Kit;
let worker: ReturnType<Kit['worker']> | undefined;

beforeEach(async () => {
  kit = await makeKit();
});

afterEach(async () => {
  await worker?.stop({ force: true });
  worker = undefined;
  await kit.close();
});

describe('worker capacity', () => {
  it('records a queue reason while the only slot is busy', async () => {
    const account = await kit.account('one');
    const agent = await kit.agent('one', account.id);
    kit.script = () => ({ events: [], hang: true });
    const first = await kit.task({ target: { agentId: agent.id } });
    const second = await kit.task({ target: { agentId: agent.id } });

    worker = kit.worker({ slots: 1 });
    await worker.start();
    await waitFor(async () => (await kit.taskStatus(first.id))?.status === 'running');
    await waitFor(async () => {
      const current = await kit.taskStatus(second.id);
      return current?.eligibility?.reason === 'waiting for worker slots';
    });
    expect((await kit.taskStatus(second.id))?.status).toBe('queued');
    expect(await kit.runs.listRuns(kit.db, kit.actor, { taskId: second.id })).toEqual([]);
  });

  it('applies a changed persisted limit without a worker restart', async () => {
    const account = await kit.account('two');
    const agent = await kit.agent('two', account.id);
    kit.script = () => ({ events: [], hang: true });
    const first = await kit.task({ target: { agentId: agent.id } });
    const second = await kit.task({ target: { agentId: agent.id } });

    kit.orgSettings.settings.workerSlots = 1;
    worker = kit.worker({ slots: 4 });
    await worker.start();
    await waitFor(async () => (await kit.taskStatus(first.id))?.status === 'running');
    await waitFor(async () => {
      const current = await kit.taskStatus(second.id);
      return current?.eligibility?.reason === 'waiting for worker slots';
    });
    kit.orgSettings.settings.workerSlots = 2;
    await waitFor(async () => (await kit.taskStatus(second.id))?.status === 'running');
  });

  it('leaves account eligibility and backoff untouched while slots are busy', async () => {
    const task = await kit.task({});
    const inPast = new Date(Date.now() - 60_000).toISOString();
    const eligibility = {
      reason: 'account reserved: reserve threshold reached until 2026-10-13T14:00:00.000Z',
      checkedAt: inPast,
      nextCheckAt: inPast,
      checks: 4,
    };
    await kit.db.update(tasksTable).set({ eligibility }).where(eq(tasksTable.id, task.id));
    const changed = await kit.db.transaction((tx) => kit.tasks.markWaitingForSlots(tx, kit.dispatcher));
    expect(changed).toBe(0);
    expect((await kit.taskStatus(task.id))?.eligibility).toEqual(eligibility);
  });

  it('derives slots from active accounts when no global override is set', async () => {
    const firstAccount = await kit.account('auto-1', 'claude', { maxConcurrentRuns: 1 });
    const secondAccount = await kit.account('auto-2', 'claude', { maxConcurrentRuns: 1 });
    const pausedAccount = await kit.account('paused', 'claude', { maxConcurrentRuns: 12 });
    await kit.accountUc.setAccountPaused(kit.db, kit.actor, pausedAccount.id, true);
    const firstAgent = await kit.agent('auto-1', firstAccount.id);
    const secondAgent = await kit.agent('auto-2', secondAccount.id);
    kit.script = () => ({ events: [], hang: true });

    const first = await kit.task({ target: { agentId: firstAgent.id } });
    const second = await kit.task({ target: { agentId: secondAgent.id } });
    const waiting = await kit.task({ target: { agentId: firstAgent.id } });
    worker = kit.worker({ slots: undefined });
    await worker.start();

    await waitFor(async () => (await kit.taskStatus(first.id))?.status === 'running');
    await waitFor(async () => (await kit.taskStatus(second.id))?.status === 'running');
    await waitFor(async () => {
      const current = await kit.taskStatus(waiting.id);
      return current?.eligibility?.reason === 'waiting for worker slots';
    });
    expect(worker.activeRuns).toBe(2);
    expect(
      kit.deps.authorizer.checks.some((check) => check.action === 'read' && check.actor.kind === 'system'),
    ).toBe(true);
  });

  it('records a stable reserve reason with the actual reset time', async () => {
    const account = await kit.account('reserve');
    const agent = await kit.agent('reserve', account.id);
    await kit.accountUc.updateAccount(kit.db, kit.actor, account.id, {
      limits: { maxConcurrentRuns: 1, stopAt: { fiveHourPercent: 90 } },
    });
    const resetAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await kit.db.transaction((tx) =>
      kit.usage.recordWindows(tx, kit.dispatcher, account.id, [
        { window: '5h', usedPercent: 92, resetsAt: resetAt },
      ]),
    );
    const task = await kit.task({ target: { agentId: agent.id } });
    worker = kit.worker({ slots: 1 });
    await worker.start();
    await waitFor(async () => {
      const current = await kit.taskStatus(task.id);
      return current?.eligibility?.reason?.includes(`until ${resetAt}`);
    });
    const reason = (await kit.taskStatus(task.id))?.eligibility?.reason;
    expect(reason).toBe(`account ${account.id}: reserve threshold reached until ${resetAt}`);
    expect(reason).not.toContain('92%');
  });
});

