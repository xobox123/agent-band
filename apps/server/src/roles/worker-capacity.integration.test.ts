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
});
