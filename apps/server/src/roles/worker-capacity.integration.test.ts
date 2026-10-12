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
  });

});
