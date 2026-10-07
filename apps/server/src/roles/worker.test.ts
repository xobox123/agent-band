import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RunSpec } from '@agent-band/contracts';
import { openPolicy } from '../ports/testing.ts';
import { runs as runsTable } from '../modules/runs/infra/schema.ts';
import { FakeAdapter } from '../runner/index.ts';
import { makeKit, waitFor, type Script } from './worker.testkit.ts';

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

const run = async (kit0: Kit, overrides = {}) => {
  const w = kit0.worker(overrides);
  workers.push(w);
  await w.start();
  return w;
};
const status = async (id: string) => (await kit.taskStatus(id))?.status;
const reachStatus = (id: string, want: string) => waitFor(async () => (await status(id)) === want, 10_000);
const runOf = async (taskId: string) => (await kit.runs.listRuns(kit.db, kit.actor, { taskId }))[0];
const actions = () => kit.deps.audit.entries.map((e) => e.action);

describe('worker', () => {
  it('runs a task for an agent target and records events, usage and the agent as tool actor', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id, { model: 'm1', persona: 'P', systemPrompt: 'S' });
    let spec: RunSpec | undefined;
    kit.script = (s) => {
      spec = s;
      return {
        events: [
          { kind: 'text', text: 'hi' },
          { kind: 'tool', name: 'Read', input: { file_path: '/work/repo/a.ts' } },
          { kind: 'usage', inputTokens: 10, outputTokens: 5, cachedTokens: 1 },
        ],
      };
    };
    const task = await kit.task({ target: { agentId: agent.id }, mode: 'edit' });
    await run(kit);
    await reachStatus(task.id, 'done');
    const r = await runOf(task.id);
    expect(r).toMatchObject({ status: 'done', agentId: agent.id, workerId: 'worker-1', inputTokens: 10 });
    expect(spec).toMatchObject({
      mode: 'edit',
      model: 'm1',
      systemPrompt: 'P\n\nS',
      workDir: '/work/repo',
      agentId: agent.id,
      gitIdentity: agent.gitIdentity,
    });
    expect(spec?.env?.['AGENT_BAND_RUN_TOKEN']).toMatch(/^[0-9a-f]{64}$/);
    const toolUse = kit.deps.audit.entries.find((e) => e.action === 'agent.tool_use');
    expect(toolUse).toMatchObject({ actorId: agent.id, targetId: r?.id });
    const decision = kit.deps.audit.entries.find((e) => e.action === 'policy.decision');
    expect(decision?.actorId).toBe(kit.dispatcher.principalId);
    expect(decision?.data).toMatchObject({ allow: true });
    expect((decision?.data as { effectivePolicyHash: string }).effectivePolicyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(actions().slice(actions().indexOf('task.create'))).toEqual([
      'task.create',
      'policy.decision',
      'task.claim',
      'run.start',
      'task.status',
      'agent.tool_use',
      'run.finish',
      'task.status',
    ]);
    const runDir = join(kit.workerDeps().runsRoot ?? '', r?.id ?? '');
    await waitFor(() => Promise.resolve(!existsSync(runDir)));
  });

  it('marks the run and task failed on a nonzero exit', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    kit.script = () => ({ events: [{ kind: 'error', message: 'boom' }], exitCode: 1 });
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit);
    await reachStatus(task.id, 'failed');
    expect(await runOf(task.id)).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('targets agents by label and by group', async () => {
    const acc = await kit.account('a');
    await kit.agent('lab', acc.id, { labels: ['backend'] });
    const group = await kit.groupUc.createGroup(kit.db, kit.actor, { name: 'g' });
    const member = await kit.agent('mem', acc.id, { groupIds: [group.id] });
    const t1 = await kit.task({ target: { label: 'backend' } });
    const t2 = await kit.task({ target: { agentGroupId: group.id } });
    await run(kit);
    await reachStatus(t1.id, 'done');
    await reachStatus(t2.id, 'done');
    expect((await runOf(t2.id))?.agentId).toBe(member.id);
  });

  it('denies a task when every candidate is denied and audits all reasons', async () => {
    const acc = await kit.account('a');
    const a = await kit.agent('a1', acc.id, { labels: ['x'] });
    await kit.agent('a2', acc.id, { labels: ['x'], enabled: false });
    kit.policy.fallback = openPolicy({ workDirSets: [['/other']] });
    const task = await kit.task({ target: { label: 'x' } });
    await run(kit);
    await reachStatus(task.id, 'denied');
    const t = await kit.taskStatus(task.id);
    expect(t?.error).toContain('workDir /work/repo is outside the allowed directories');
    expect(t?.error).toContain('agent is disabled');
    const decisions = kit.deps.audit.entries.filter((e) => e.action === 'policy.decision');
    expect(decisions).toHaveLength(2);
    expect(decisions.every((e) => !(e.data as { allow: boolean }).allow)).toBe(true);
    expect(a.id).toBeTruthy();
    expect(kit.adapters.get(acc.id)?.started).toHaveLength(0);
  });

  it('denies an explicit target whose agent does not exist', async () => {
    const task = await kit.task({ target: { agentId: '00000000-0000-4000-8000-000000000001' } });
    await run(kit);
    await reachStatus(task.id, 'denied');
    expect((await kit.taskStatus(task.id))?.error).toBe('target agent not found');
  });

  it('releases the task instead of failing over to another account', async () => {
    const acc1 = await kit.account('a1');
    const acc2 = await kit.account('a2');
    await kit.agent('first', acc1.id, { labels: ['x'] });
    await kit.agent('second', acc2.id, { labels: ['x'] });
    await kit.db.transaction((tx) =>
      kit.usage.blockAccount(tx, kit.dispatcher, acc1.id, new Date(Date.now() + 3_600_000)),
    );
    const task = await kit.task({ target: { label: 'x' } });
    await run(kit);
    await waitFor(async () => (await kit.taskStatus(task.id))?.error?.startsWith('no eligible agent: '));
    await new Promise((r) => setTimeout(r, 150));
    const t = await kit.taskStatus(task.id);
    expect(t?.status).toBe('queued');
    expect(t?.error).toContain('rate limited');
    expect(kit.adapters.get(acc2.id)?.started).toHaveLength(0);
    expect(actions()).not.toContain('task.failover');
  });

  it('fails over to another account only when the policy enables it', async () => {
    const acc1 = await kit.account('a1');
    const acc2 = await kit.account('a2');
    await kit.agent('first', acc1.id, { labels: ['x'] });
    const second = await kit.agent('second', acc2.id, { labels: ['x'] });
    kit.policy.fallback = openPolicy({ allowAccountFailover: true });
    await kit.db.transaction((tx) =>
      kit.usage.blockAccount(tx, kit.dispatcher, acc1.id, new Date(Date.now() + 3_600_000)),
    );
    const task = await kit.task({ target: { label: 'x' } });
    await run(kit);
    await reachStatus(task.id, 'done');
    expect((await runOf(task.id))?.agentId).toBe(second.id);
    const failover = kit.deps.audit.entries.find((e) => e.action === 'task.failover');
    expect(failover?.data).toMatchObject({ fromAccountId: acc1.id, toAccountId: acc2.id });
  });

  it('requires failover to be enabled on the blocked candidate too', async () => {
    const acc1 = await kit.account('a1');
    const acc2 = await kit.account('a2');
    const first = await kit.agent('first', acc1.id, { labels: ['x'] });
    await kit.agent('second', acc2.id, { labels: ['x'] });
    kit.policy.fallback = openPolicy({ allowAccountFailover: true });
    kit.policy.byAgent.set(first.id, openPolicy({ allowAccountFailover: false }));
    await kit.db.transaction((tx) =>
      kit.usage.blockAccount(tx, kit.dispatcher, acc1.id, new Date(Date.now() + 3_600_000)),
    );
    const task = await kit.task({ target: { label: 'x' } });
    await run(kit);
    await waitFor(async () => (await kit.taskStatus(task.id))?.error?.startsWith('no eligible agent: '));
    expect(kit.adapters.get(acc2.id)?.started).toHaveLength(0);
  });

  it('respects the account concurrency limit by releasing the task', async () => {
    const acc = await kit.account('a', 'claude', { maxConcurrentRuns: 1 });
    await kit.agent('one', acc.id, { labels: ['x'] });
    kit.script = () => ({ events: [{ kind: 'text', text: 'a' }], hang: true });
    const t1 = await kit.task({ target: { label: 'x' } });
    await run(kit);
    await reachStatus(t1.id, 'running');
    const t2 = await kit.task({ target: { label: 'x' } });
    await waitFor(async () => (await kit.taskStatus(t2.id))?.error?.includes('concurrent run limit'));
    expect(await status(t2.id)).toBe('queued');
  });

  it('records rate-limit windows, blocks the account and ends rate_limited', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    kit.script = () => ({
      events: [
        {
          kind: 'rate_limit',
          windows: [{ window: '5h', usedPercent: 100, resetsAt }],
          limitReached: true,
          resetsAt,
        },
      ],
    });
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit);
    await reachStatus(task.id, 'rate_limited');
    expect((await runOf(task.id))?.status).toBe('rate_limited');
    expect(await kit.usage.accountBlock(kit.db, kit.actor, acc.id)).toBeInstanceOf(Date);
    expect((await kit.usage.latestWindows(kit.db, kit.actor, acc.id))[0]?.usedPercent).toBe(100);
    expect(actions()).toContain('run.rate_limited');
  });

  it('plans an automatic resume at the account block plus jitter', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    const resetsAt = new Date(Date.now() + 3_600_000);
    kit.script = () => ({
      events: [
        {
          kind: 'rate_limit',
          windows: [{ window: '5h', usedPercent: 100, resetsAt: resetsAt.toISOString() }],
          limitReached: true,
          resetsAt: resetsAt.toISOString(),
        },
      ],
    });
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit, { resumeJitterMs: () => 30_000 });
    await reachStatus(task.id, 'rate_limited');
    const t = await kit.taskStatus(task.id);
    expect(t?.resumeAt?.getTime()).toBe(resetsAt.getTime() + 30_000);
    expect(t).toMatchObject({ attempt: 1, maxAttempts: 3 });
  });

  it('cancels a running task through the outbox event', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    kit.script = () => ({ events: [{ kind: 'text', text: 'working' }], hang: true });
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit);
    await reachStatus(task.id, 'running');
    await kit.tasks.cancelTask(kit.db, kit.actor, task.id);
    await waitFor(async () => (await runOf(task.id))?.status === 'cancelled');
    expect(await status(task.id)).toBe('cancelled');
  });

  it('kills a run that exceeds maxRunMinutes', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    kit.policy.fallback = openPolicy({ maxRunMinutes: 1 });
    kit.script = () => ({ events: [{ kind: 'text', text: 'slow' }], hang: true });
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit, { minuteMs: 60 });
    await reachStatus(task.id, 'failed');
    expect(await runOf(task.id)).toMatchObject({ status: 'failed', error: 'maxRunMinutes (1) exceeded' });
  });

  it('never runs the same task twice with two workers on one database', async () => {
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    kit.script = () => ({ events: [{ kind: 'text', text: 'a' }], delayMs: 5 });
    const tasks = await Promise.all(Array.from({ length: 8 }, () => kit.task({ target: { label: 'x' } })));
    await run(kit, { workerId: 'w1', slots: 2 });
    await run(kit, { workerId: 'w2', slots: 2 });
    for (const t of tasks) await reachStatus(t.id, 'done');
    const all = await kit.db.select().from(runsTable);
    expect(all).toHaveLength(8);
    expect(new Set(all.map((r) => r.taskId)).size).toBe(8);
    const started = [...kit.adapters.values()].flatMap((a) => a.started.map((s) => s.prompt));
    expect(new Set(started).size).toBe(8);
    expect(started).toHaveLength(8);
  });

  it('materialises skills as a Claude plugin with the hook and records them on the run', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    const enc = (s: string) => new TextEncoder().encode(s);
    kit.skills.fallback = [{ skillId: 'sk-1', name: 'lint', version: 2, contentHash: 'h1' }];
    kit.skills.bundles.set('sk-1@2', { 'SKILL.md': enc('# lint'), 'refs/a.md': enc('ref') });
    const seen: Record<string, string | boolean> = {};
    kit.script = (s) => {
      const dir = s.skillsDir ?? '';
      seen['dir'] = dir;
      seen['manifest'] = readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8');
      seen['skill'] = readFileSync(join(dir, 'skills/lint/SKILL.md'), 'utf8');
      seen['ref'] = readFileSync(join(dir, 'skills/lint/refs/a.md'), 'utf8');
      seen['hooks'] = readFileSync(join(dir, 'hooks/hooks.json'), 'utf8');
      seen['script'] = readFileSync(join(dir, 'hooks/authorize-tool.mjs'), 'utf8');
      return { events: [{ kind: 'text', text: 'x' }] };
    };
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit);
    await reachStatus(task.id, 'done');
    expect(JSON.parse(String(seen['manifest']))).toMatchObject({ name: 'agent-band-run' });
    expect(seen['skill']).toBe('# lint');
    expect(seen['ref']).toBe('ref');
    expect(
      (JSON.parse(String(seen['hooks'])) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } })
        .hooks.PreToolUse[0]?.hooks[0]?.command,
    ).toContain('authorize-tool.mjs');
    expect(String(seen['script'])).toContain('/authorize-tool');
    const r = await runOf(task.id);
    expect(r?.skills).toEqual([{ skillId: 'sk-1', version: 2, contentHash: 'h1' }]);
    await waitFor(() => Promise.resolve(!existsSync(String(seen['dir']))));
  });

  it('skips skills for providers without safe per-run loading and says so', async () => {
    const acc = await kit.account('codex', 'openai');
    const agent = await kit.agent('cx', acc.id);
    kit.skills.fallback = [{ skillId: 'sk-1', name: 'lint', version: 1, contentHash: 'h1' }];
    let spec: RunSpec | undefined;
    kit.script = (s) => {
      spec = s;
      return { events: [] };
    };
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit);
    await reachStatus(task.id, 'done');
    const r = await runOf(task.id);
    expect(spec?.skillsDir).toBeUndefined();
    expect(r?.skills).toEqual([]);
    expect(r?.effectivePolicy['skillsNote']).toBe('skills not supported for provider');
    const events = await kit.runs.listRunEvents(kit.db, kit.actor, r?.id ?? '');
    expect(events.some((e) => JSON.stringify(e.payload).includes('skills not supported for provider'))).toBe(
      true,
    );
  });

  it('fails runs left running by a previous worker with the same id on start', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    const task = await kit.task({ target: { agentId: agent.id } });
    await kit.db.transaction(async (tx) => {
      const claimed = await kit.tasks.claimNextTask(tx, kit.dispatcher, 'worker-1');
      await kit.runs.startRun(tx, kit.dispatcher, {
        taskId: task.id,
        agentId: agent.id,
        accountId: acc.id,
        workerId: 'worker-1',
        effectivePolicy: {},
        skills: [],
      });
      await kit.tasks.setTaskStatus(tx, kit.dispatcher, claimed?.id ?? '', 'running');
    });
    await run(kit);
    await reachStatus(task.id, 'failed');
    expect((await runOf(task.id))?.status).toBe('failed');
  });

  it('stops gracefully: drains active runs unless forced', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    kit.script = () => ({ events: [{ kind: 'text', text: 'x' }], delayMs: 60 });
    const task = await kit.task({ target: { agentId: agent.id } });
    const w = await run(kit);
    await reachStatus(task.id, 'running');
    await w.stop();
    expect(w.activeRuns).toBe(0);
    expect(await status(task.id)).toBe('done');
    const t2 = await kit.task({ target: { agentId: agent.id } });
    await new Promise((r) => setTimeout(r, 100));
    expect(await status(t2.id)).toBe('queued');
    expect(await kit.db.select().from(runsTable).where(eq(runsTable.taskId, t2.id))).toHaveLength(0);
  });
});

describe('script type', () => {
  it('is used', () => {
    const s: Script = () => ({ events: [] });
    expect(s).toBeTypeOf('function');
  });
});

describe('worker and goals', () => {
  it('stores a truncated result summary and outcome for subtask runs', async () => {
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id);
    kit.script = () => ({
      events: [
        { kind: 'text', text: 'first' },
        { kind: 'text', text: 'x'.repeat(6000) },
      ],
    });
    const goal = await kit.task({ target: { agentId: agent.id }, kind: 'goal' });
    const child = await kit.db.transaction((tx) =>
      kit.tasks.createChildTask(
        tx,
        kit.actor,
        { title: 'c', prompt: 'p', workDir: '/work/repo', target: { agentId: agent.id } },
        { kind: 'task', rootTaskId: goal.id, parentTaskId: goal.id, depth: 1, dependsOn: [] },
      ),
    );
    const bad = await kit.db.transaction((tx) =>
      kit.tasks.createChildTask(
        tx,
        kit.actor,
        { title: 'c2', prompt: 'p2', workDir: '/work/repo', target: { agentId: agent.id } },
        { kind: 'review', rootTaskId: goal.id, parentTaskId: goal.id, depth: 1, dependsOn: [child.id] },
      ),
    );
    await run(kit);
    await reachStatus(child.id, 'done');
    const t = await kit.taskStatus(child.id);
    expect(t?.result?.outcome).toBe('success');
    expect(Buffer.byteLength(t?.result?.summary ?? '')).toBe(4096);
    await reachStatus(bad.id, 'done');
  });

  it('sets the goal to waiting with the session id when a leader run ends without completing', async () => {
    const acc = await kit.account('a');
    const leader = await kit.agent('lead', acc.id, { role: 'leader' });
    kit.script = () => ({ events: [{ kind: 'session', sessionId: 'sess-9' }] });
    const goal = await kit.task({ target: { agentId: leader.id }, kind: 'goal' });
    await run(kit);
    await reachStatus(goal.id, 'done');
    const state = await waitFor(async () => {
      const g = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
      return g?.status === 'waiting' && g;
    });
    expect(state).toMatchObject({ leaderAgentId: leader.id, leaderSessionId: 'sess-9', round: 1 });
  });

  it('denies a goal for an agent that is not a leader', async () => {
    const acc = await kit.account('a');
    const worker = await kit.agent('w', acc.id);
    const goal = await kit.task({ target: { agentId: worker.id }, kind: 'goal' });
    await run(kit);
    await reachStatus(goal.id, 'denied');
    expect((await kit.taskStatus(goal.id))?.error).toContain('role leader');
  });

  it('fails the goal when the leader run fails', async () => {
    const acc = await kit.account('a');
    const leader = await kit.agent('lead', acc.id, { role: 'leader' });
    kit.script = () => ({ events: [{ kind: 'error', message: 'boom' }], exitCode: 1 });
    const goal = await kit.task({ target: { agentId: leader.id }, kind: 'goal' });
    await run(kit);
    await reachStatus(goal.id, 'failed');
    const state = await waitFor(async () => {
      const g = await kit.tasks.getGoalState(kit.db, kit.actor.orgId, goal.id);
      return g?.status === 'failed' && g;
    });
    expect(state.reason).toContain('boom');
  });
});

describe('worker eligibility', () => {
  it('does not churn claims or audit rows for a task with no eligible agent, and picks it up once one exists', async () => {
    const acc = await kit.account('a');
    const task = await kit.task({ target: { label: 'ghost' } });
    await run(kit, { pollIntervalMs: 20, retryDelayMs: 1000 });
    await waitFor(async () => (await kit.taskStatus(task.id))?.eligibility?.reason);
    await new Promise((r) => setTimeout(r, 400));
    const mine = kit.deps.audit.entries.filter((e) => e.targetId === task.id).map((e) => e.action);
    expect(mine.filter((a) => a === 'task.ineligible')).toHaveLength(1);
    expect(mine.filter((a) => a === 'task.claim' || a === 'task.release')).toHaveLength(0);
    expect(mine.length).toBeLessThanOrEqual(2);
    expect((await kit.taskStatus(task.id))?.eligibility?.reason).toBe('no matching agent');

    await kit.agent('ghost1', acc.id, { labels: ['ghost'] });
    kit.script = () => ({ events: [{ kind: 'text', text: 'ok' }] });
    await reachStatus(task.id, 'done');
  });

  it('injects an api key only into the spawned environment and never records it', async () => {
    const key = 'sk-ant-worker-secret';
    const acc = await kit.accountUc.createAccount(kit.db, kit.actor, {
      name: 'billing',
      provider: 'claude',
      type: 'api',
      secret: key,
      limits: { maxConcurrentRuns: 2 },
    });
    kit.adapters.set(acc.id, new FakeAdapter((s) => kit.script(s)));
    const agent = await kit.agent('keyed', acc.id);
    let spec: RunSpec | undefined;
    kit.script = (s) => {
      spec = s;
      return {
        events: [
          { kind: 'text', text: 'done' },
          { kind: 'usage', inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0.02 },
        ],
      };
    };
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit);
    await reachStatus(task.id, 'done');
    expect(spec?.env?.ANTHROPIC_API_KEY).toBe(key);
    expect(spec?.configDir).toBe(acc.configDir);
    const r = await runOf(task.id);
    const events = await kit.runs.listRunEvents(kit.db, kit.actor, r?.id ?? '');
    expect(JSON.stringify(events)).not.toContain(key);
    expect(JSON.stringify(kit.deps.audit.entries)).not.toContain(key);
    expect(JSON.stringify(r)).not.toContain(key);
  });

  it('does not start new work on an account whose fresh window is over the reserve threshold', async () => {
    const acc = await kit.account('reserve', 'claude', {
      maxConcurrentRuns: 2,
      stopAt: { fiveHourPercent: 70 },
    } as never);
    const agent = await kit.agent('res', acc.id);
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    await kit.db.transaction((tx) =>
      kit.usage.recordWindows(tx, kit.dispatcher, acc.id, [{ window: '5h', usedPercent: 72, resetsAt }]),
    );
    const task = await kit.task({ target: { agentId: agent.id } });
    await run(kit, { refreshLimits: () => Promise.resolve() });
    await new Promise((r) => setTimeout(r, 400));
    expect(await status(task.id)).not.toBe('done');
    expect(await runOf(task.id)).toBeUndefined();
    await kit.db.transaction((tx) =>
      kit.usage.recordWindows(tx, kit.dispatcher, acc.id, [{ window: '5h', usedPercent: 10, resetsAt }]),
    );
    await reachStatus(task.id, 'done');
  });
});
