import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedEvent, RunSpec } from '@agent-band/contracts';
import { openTestDatabase, type Database } from '../platform/db.ts';
import { EventStream } from '../platform/outbox.ts';
import {
  fakeDeps,
  FakeEffectivePolicySource,
  FakeEffectiveSkillsSource,
  FakeOrgSettings,
  FakePrincipalRegistry,
  testActor,
} from '../ports/testing.ts';
import { accountHasAgents, createAgentUseCases, createGroupUseCases } from '../modules/agents/index.ts';
import { createAccountUseCases, fixedKeySource } from '../modules/accounts/index.ts';
import { createRuns } from '../modules/runs/index.ts';
import { createTasks } from '../modules/tasks/index.ts';
import { createUsage } from '../modules/usage/index.ts';
import { FakeAdapter } from '../runner/index.ts';
import { createWorker, type Worker, type WorkerDeps } from './worker.ts';

export type Script = (s: RunSpec) => {
  events: NormalizedEvent[];
  exitCode?: number;
  delayMs?: number;
  hang?: boolean;
};

export async function makeKit(existing?: Database) {
  const database = existing ?? (await openTestDatabase());
  const db = database.db;
  const deps = fakeDeps();
  const actor = testActor();
  const dispatcher = { ...actor, kind: 'system' as const };
  const policy = new FakeEffectivePolicySource();
  const skills = new FakeEffectiveSkillsSource();
  const accountUc = createAccountUseCases({
    ...deps,
    secretKey: fixedKeySource(randomBytes(32)),
    home: tmpdir(),
    accountHasAgents,
  });
  const agentUc = createAgentUseCases({
    ...deps,
    principals: new FakePrincipalRegistry(),
    accountExists: accountUc.accountExists,
  });
  const groupUc = createGroupUseCases(deps);
  const orgSettings = new FakeOrgSettings();
  const tasks = createTasks({ ...deps, orgSettings });
  const runs = createRuns(deps);
  const usage = createUsage({
    ...deps,
    orgSettings: new FakeOrgSettings(),
    usageOnDay: (...a) => runs.usageOnDay(...a),
    runningCount: (...a) => runs.runningCount(...a),
  });
  const events = new EventStream(database);
  const kit = {
    db,
    deps,
    actor,
    dispatcher,
    policy,
    skills,
    accountUc,
    agentUc,
    groupUc,
    tasks,
    runs,
    usage,
    events,
    script: ((): ReturnType<Script> => ({ events: [{ kind: 'text', text: 'ok' }] })) as Script,
    adapters: new Map<string, FakeAdapter>(),
    async account(name: string, provider = 'claude', limits = { maxConcurrentRuns: 4 }) {
      const acc = await accountUc.createAccount(db, actor, { name, provider, type: 'cli', limits });
      kit.adapters.set(acc.id, new FakeAdapter((s) => kit.script(s)));
      return acc;
    },
    async agent(slug: string, accountId: string, extra: Record<string, unknown> = {}) {
      return agentUc.createAgent(db, actor, { slug, name: slug, accountId, ...extra });
    },
    task(input: Record<string, unknown>) {
      return tasks.createTask(db, actor, {
        title: 't',
        prompt: `prompt-${Math.random()}`,
        workDir: '/work/repo',
        target: { label: 'x' },
        ...input,
      });
    },
    orgSettings,
    workerDeps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
      return {
        db,
        orgSettings,
        dispatcher,
        workerId: 'worker-1',
        slots: 4,
        apiPort: 4870,
        events,
        audit: deps.audit,
        tasks,
        runs,
        usage,
        agents: agentUc,
        accounts: accountUc,
        policy,
        skills,
        adapterFor: (acc) => kit.adapters.get(acc.id),
        pollIntervalMs: 20,
        retryDelayMs: 30,
        minuteMs: 40,
        runsRoot: join(tmpdir(), 'agent-band-test-runs'),
        ...overrides,
      };
    },
    worker(overrides: Partial<WorkerDeps> = {}): Worker {
      return createWorker(kit.workerDeps(overrides));
    },
    async taskStatus(id: string) {
      const rows = await tasks.listTasks(db, actor);
      return rows.find((t) => t.id === id);
    },
    async close() {
      await events.stop();
      await database.close();
    },
  };
  return kit;
}

export async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'agent-band-t9-'));
