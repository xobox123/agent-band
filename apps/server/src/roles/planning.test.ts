import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunSpec } from '@agent-band/contracts';
import { makeKit, waitFor } from './worker.testkit.ts';

type Kit = Awaited<ReturnType<typeof makeKit>>;
let kit: Kit;
let workers: { stop(o?: { force?: boolean }): Promise<void> }[] = [];

beforeEach(async () => {
  kit = await makeKit();
  workers = [];
});
afterEach(async () => {
  for (const w of workers) await w.stop({ force: true });
  await kit.close();
});

const run = async () => {
  const w = kit.worker();
  workers.push(w);
  await w.start();
  return w;
};
const status = async (id: string) => (await kit.taskStatus(id))?.status;
const reach = (id: string, want: string) => waitFor(async () => (await status(id)) === want, 10_000);
const runsOf = (taskId: string) => kit.runs.listRuns(kit.db, kit.actor, { taskId });
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

describe('drafts', () => {
  it('are never claimed, and start makes them claimable', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    const draft = await kit.task({ target: { agentId: agent.id }, draft: true });
    expect(draft.status).toBe('draft');
    await run();
    await settle();
    expect(await status(draft.id)).toBe('draft');
    expect(await runsOf(draft.id)).toHaveLength(0);
    await kit.tasks.startTasks(kit.db, kit.actor, [draft.id]);
    await reach(draft.id, 'done');
  });
});

describe('pause', () => {
  async function paused(setup: (a: { accountId: string; agentId: string }) => Promise<() => Promise<void>>) {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    const resume = await setup({ accountId: acc.id, agentId: agent.id });
    const task = await kit.task({ target: { agentId: agent.id } });
    await run();
    const t = await waitFor(async () => {
      const x = await kit.taskStatus(task.id);
      return x?.eligibility?.reason === 'paused' ? x : undefined;
    });
    expect(t.status).toBe('queued');
    expect(await runsOf(task.id)).toHaveLength(0);
    await resume();
    await reach(task.id, 'done');
  }

  it('an organization blocks claiming until resumed', async () => {
    await paused(() => {
      kit.orgSettings.settings.paused = true;
      return Promise.resolve(async () => {
        kit.orgSettings.settings.paused = false;
        await kit.db.transaction((tx) => kit.tasks.clearEligibility(tx, kit.dispatcher));
      });
    });
  });

  it('an account blocks its agents until resumed', async () => {
    await paused(async ({ accountId }) => {
      await kit.accountUc.setAccountPaused(kit.db, kit.actor, accountId, true);
      return async () => {
        await kit.accountUc.setAccountPaused(kit.db, kit.actor, accountId, false);
        await kit.db.transaction((tx) => kit.tasks.clearEligibility(tx, kit.dispatcher));
      };
    });
    expect(kit.deps.audit.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['account.pause', 'account.resume']),
    );
  });

  it('an agent blocks its tasks until resumed, and a label target picks an unpaused agent', async () => {
    await paused(async ({ agentId }) => {
      await kit.agentUc.setAgentPaused(kit.db, kit.actor, agentId, true);
      return async () => {
        await kit.agentUc.setAgentPaused(kit.db, kit.actor, agentId, false);
        await kit.db.transaction((tx) => kit.tasks.clearEligibility(tx, kit.dispatcher));
      };
    });
    expect(kit.deps.audit.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['agent.pause', 'agent.resume']),
    );
  });

  it('skips a paused agent when another one matches the label', async () => {
    const acc = await kit.account('a');
    const p = await kit.agent('p', acc.id, { labels: ['x'] });
    const ok = await kit.agent('ok', acc.id, { labels: ['x'] });
    await kit.agentUc.setAgentPaused(kit.db, kit.actor, p.id, true);
    const task = await kit.task({ target: { label: 'x' } });
    await run();
    await reach(task.id, 'done');
    expect((await runsOf(task.id))[0]?.agentId).toBe(ok.id);
  });
});

describe('plan approval cap', () => {
  it('caps the leader planning turn at read-only even when the policy allows edit', async () => {
    const acc = await kit.account('a');
    const leader = await kit.agent('lead', acc.id, { role: 'leader' });
    let spec: RunSpec | undefined;
    kit.script = (s) => {
      spec = s;
      return { events: [{ kind: 'session', sessionId: 's1' }] };
    };
    const goal = await kit.task({
      target: { agentId: leader.id },
      kind: 'goal',
      mode: 'edit',
      approval: 'required',
    });
    await kit.db.transaction((tx) =>
      kit.tasks.createChildTask(
        tx,
        kit.actor,
        { title: 'c', prompt: 'p', workDir: '/work/repo', target: { agentId: leader.id } },
        { kind: 'task', rootTaskId: goal.id, parentTaskId: goal.id, depth: 1, dependsOn: [], proposed: true },
      ),
    );
    await run();
    await waitFor(async () => {
      const g = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
      return g?.status === 'awaiting_approval';
    });
    expect(spec?.mode).toBe('read-only');
    expect(spec?.systemPrompt).toContain('requires human plan approval');
    const r = (await runsOf(goal.id))[0];
    expect(r?.effectivePolicy).toMatchObject({ mode: 'read-only', plannedMode: 'edit' });
  });

  it('keeps the planned mode when approval is not required', async () => {
    const acc = await kit.account('a');
    const leader = await kit.agent('lead', acc.id, { role: 'leader' });
    let spec: RunSpec | undefined;
    kit.script = (s) => {
      spec = s;
      return { events: [] };
    };
    const goal = await kit.task({ target: { agentId: leader.id }, kind: 'goal', mode: 'edit' });
    await run();
    await reach(goal.id, 'done');
    expect(spec?.mode).toBe('edit');
  });
});
