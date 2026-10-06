import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MCP_TOOLS_ALLOW,
  RUN_ID_HEADER,
  RUN_TOKEN_HEADER,
  type NormalizedEvent,
  type ProviderAdapter,
  type RunHandle,
  type RunSpec,
} from '@agent-band/contracts';
import { newRunToken, registerRunAuth } from '../../execution/app/run-auth.ts';
import { FakeEffectivePolicySource, FakeEffectiveSkillsSource, openPolicy } from '../../ports/testing.ts';
import { createWorker, type Worker } from '../../roles/worker.ts';
import { claudeArgs } from '../../runner/adapters.ts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  await api.close();
});

const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

interface Rpc {
  jsonrpc: string;
  id: number | null;
  result?: {
    tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
    protocolVersion?: string;
  };
  error?: { code: number; message: string };
}

const post = (headers: Record<string, string>, payload: unknown) =>
  api.app.inject({ method: 'POST', url: '/api/v1/mcp', headers, payload: payload as object });

const rpc = async (
  creds: { runId: string; token: string },
  method: string,
  params?: unknown,
  id = 1,
): Promise<Rpc> => {
  const res = await post(
    { [RUN_ID_HEADER]: creds.runId, [RUN_TOKEN_HEADER]: creds.token },
    { jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) },
  );
  expect(res.statusCode).toBe(200);
  return res.json<Rpc>();
};

const call = (creds: { runId: string; token: string }, name: string, args: unknown) =>
  rpc(creds, 'tools/call', { name, arguments: args });

const textOf = (r: Rpc): string => r.result?.content?.[0]?.text ?? '';

async function seed(extra: { delegate?: boolean } = {}) {
  const { c } = api;
  const account = await c.accounts.createAccount(api.database.db, c.localUser, {
    name: 'acc',
    provider: 'claude',
    type: 'cli',
    limits: { maxConcurrentRuns: 4 },
  });
  const mk = (slug: string, role: 'leader' | 'worker' | 'reviewer', labels: string[] = []) =>
    c.agents.createAgent(api.database.db, c.localUser, {
      slug,
      name: slug,
      accountId: account.id,
      role,
      labels,
    });
  const leader = await mk('lead', 'leader');
  const w1 = await mk('w1', 'worker', ['be']);
  const w2 = await mk('w2', 'worker', ['fe']);
  const policy = openPolicy({ canDelegate: extra.delegate === false ? false : true, maxMode: 'edit' });
  return { account, leader, w1, w2, policy };
}

/** Starts a running leader run by hand so the MCP endpoint can be called as that run. */
async function runningLeader(delegate = true) {
  const s = await seed({ delegate });
  const { c } = api;
  const db = api.database.db;
  const goal = await c.tasks.createTask(db, c.localUser, {
    title: 'Goal',
    prompt: 'Build it',
    workDir: '/work/repo',
    target: { agentId: s.leader.id },
    kind: 'goal',
  });
  const token = newRunToken();
  const run = await db.transaction(async (tx) => {
    await c.tasks.claimNextTask(tx, c.dispatcher, 'w');
    const r = await c.runs.startRun(tx, c.dispatcher, {
      taskId: goal.id,
      agentId: s.leader.id,
      accountId: s.account.id,
      workerId: 'w',
      effectivePolicy: { ...s.policy, mode: 'edit' },
      skills: [],
    });
    await c.tasks.setTaskStatus(tx, c.dispatcher, goal.id, 'running');
    await registerRunAuth(tx, {
      runId: r.id,
      orgId: c.orgId,
      agentId: s.leader.id,
      workDir: goal.workDir,
      token,
      policy: { deniedTools: [], workDirSets: [] },
    });
    return r;
  });
  return { ...s, goal, creds: { runId: run.id, token } };
}

describe('MCP protocol', () => {
  it('answers initialize with tools capability and echoes a supported protocol version', async () => {
    const { creds } = await runningLeader();
    const r = await rpc(creds, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    expect(r.result).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-band' },
    });
    expect((await rpc(creds, 'ping')).result).toEqual({});
  });

  it('accepts notifications with 202 and rejects unknown methods', async () => {
    const { creds } = await runningLeader();
    const headers = { [RUN_ID_HEADER]: creds.runId, [RUN_TOKEN_HEADER]: creds.token };
    const n = await post(headers, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(n.statusCode).toBe(202);
    const r = await rpc(creds, 'nope/nope');
    expect(r.error?.code).toBe(-32601);
    expect((await api.app.inject({ method: 'GET', url: '/api/v1/mcp' })).statusCode).toBe(405);
  });

  it('lists exactly the seven tools with JSON Schema inputs', async () => {
    const { creds } = await runningLeader();
    const tools = (await rpc(creds, 'tools/list')).result?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'complete_goal',
        'create_subtask',
        'get_task',
        'list_agents',
        'list_subtasks',
        'post_note',
        'request_review',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.inputSchema['type']).toBe('object');
      expect(t.inputSchema['$schema']).toBeUndefined();
    }
    const create = tools.find((t) => t.name === 'create_subtask');
    expect(create?.inputSchema['required']).toEqual(
      expect.arrayContaining(['title', 'prompt', 'workDir', 'target']),
    );
    expect(create?.description).toContain('asynchronously');
  });

  it('runs tools and returns tool failures as isError results, not transport errors', async () => {
    const { creds, w1 } = await runningLeader();
    const agents = await call(creds, 'list_agents', {});
    expect(agents.result?.isError).toBeUndefined();
    expect((JSON.parse(textOf(agents)) as { handle: string }[]).map((a) => a.handle)).toEqual(
      expect.arrayContaining([w1.handle]),
    );

    const created = await call(creds, 'create_subtask', {
      title: 'Backend',
      prompt: 'Do it',
      workDir: '/work/repo/api',
      target: { agentId: w1.id },
    });
    expect(created.result?.isError).toBeUndefined();
    const sub = JSON.parse(textOf(created)) as { key: string; status: string };
    expect(sub.status).toBe('queued');
    expect(textOf(await call(creds, 'list_subtasks', {}))).toContain(sub.key);
    expect(textOf(await call(creds, 'get_task', { key: sub.key }))).toContain('Backend');
    expect((await call(creds, 'post_note', { text: 'planning' })).result?.isError).toBeUndefined();

    const outside = await call(creds, 'create_subtask', {
      title: 'x',
      prompt: 'y',
      workDir: '/elsewhere',
      target: { agentId: w1.id },
    });
    expect(outside.result?.isError).toBe(true);
    expect(textOf(outside)).toContain('forbidden (403)');

    const invalid = await call(creds, 'create_subtask', { title: 'x' });
    expect(invalid.result?.isError).toBe(true);
    expect(textOf(invalid)).toContain('validation_failed (400)');

    const missing = await call(creds, 'get_task', { key: 'NOPE-1' });
    expect(missing.result?.isError).toBe(true);
    expect(textOf(missing)).toContain('404');

    const done = await call(creds, 'complete_goal', { summary: 'ok', outcome: 'success' });
    expect(done.result?.isError).toBeUndefined();
    const again = await call(creds, 'create_subtask', {
      title: 'late',
      prompt: 'y',
      workDir: '/work/repo',
      target: { agentId: w1.id },
    });
    expect(again.result?.isError).toBe(true);
    expect(textOf(again)).toContain('409');
  });

  it('reports a policy refusal as an isError result and an unknown tool as a JSON-RPC error', async () => {
    const { creds, w1 } = await runningLeader(false);
    const r = await call(creds, 'create_subtask', {
      title: 'x',
      prompt: 'y',
      workDir: '/work/repo',
      target: { agentId: w1.id },
    });
    expect(r.result?.isError).toBe(true);
    expect(textOf(r)).toContain('delegation is not allowed by policy');
    const unknown = await call(creds, 'rm_rf', {});
    expect(unknown.error?.code).toBe(-32602);
  });

  it('rejects a bad or missing token with 401 and a JSON-RPC error', async () => {
    const { creds } = await runningLeader();
    const body = { jsonrpc: '2.0', id: 7, method: 'tools/list' };
    const bad = await post({ [RUN_ID_HEADER]: creds.runId, [RUN_TOKEN_HEADER]: 'nope' }, body);
    expect(bad.statusCode).toBe(401);
    expect(bad.json<Rpc>()).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32001 } });
    const none = await post({}, body);
    expect(none.statusCode).toBe(401);
    expect(none.json<Rpc>().error?.code).toBe(-32001);
  });
});

describe('leader runner arguments', () => {
  const base: RunSpec = {
    runId: 'r',
    agentId: 'a',
    prompt: 'goal',
    workDir: '/w',
    configDir: '/c',
    mode: 'edit',
    gitIdentity: { name: 'n', email: 'e@x' },
  };

  it('attaches the MCP config and pre-approves only the delegation tools', () => {
    const args = claudeArgs({ ...base, mcpConfigPath: '/runs/r/mcp.json' });
    expect(args).toEqual(expect.arrayContaining(['--mcp-config', '/runs/r/mcp.json', '--strict-mcp-config']));
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(MCP_TOOLS_ALLOW);
    expect(args).not.toContain('--resume');
    const withTools = claudeArgs({ ...base, mcpConfigPath: '/m', allowedTools: ['Read'] });
    expect(withTools[withTools.indexOf('--allowedTools') + 1]).toBe(`Read,${MCP_TOOLS_ALLOW}`);
  });

  it('resumes the previous session on continuation turns', () => {
    const args = claudeArgs({ ...base, mcpConfigPath: '/m', resumeSessionId: 'sess-1' });
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-1');
  });

  it('leaves non-goal runs untouched', () => {
    const args = claudeArgs(base);
    for (const flag of ['--mcp-config', '--strict-mcp-config', '--allowedTools', '--resume'])
      expect(args).not.toContain(flag);
  });
});

describe('goal runs through the worker', () => {
  /** Adapter whose "agent" performs MCP calls over the HTTP endpoint while it runs. */
  class ScriptedAdapter implements ProviderAdapter {
    readonly provider = 'claude';
    readonly specs: RunSpec[] = [];
    readonly configs: string[] = [];
    constructor(private readonly script: (s: RunSpec, call: McpCall) => Promise<NormalizedEvent[]>) {}
    start(s: RunSpec): RunHandle {
      this.specs.push(s);
      if (s.mcpConfigPath) this.configs.push(readFileSync(s.mcpConfigPath, 'utf8'));
      const call: McpCall = (name, args) =>
        callTool({ runId: s.runId, token: s.env?.['AGENT_BAND_RUN_TOKEN'] ?? '' }, name, args);
      let finish!: (r: { exitCode: number | null }) => void;
      const done = new Promise<{ exitCode: number | null }>((r) => {
        finish = r;
      });
      const script = this.script;
      const events = (async function* () {
        const out = await script(s, call);
        for (const e of out) yield e;
        finish({ exitCode: 0 });
      })();
      return {
        events,
        done,
        cancel: () => {
          finish({ exitCode: null });
        },
      };
    }
  }
  type McpCall = (name: string, args: unknown) => Promise<Rpc>;
  const callTool = (creds: { runId: string; token: string }, name: string, args: unknown) =>
    call(creds, name, args);

  let worker: Worker | undefined;
  afterEach(async () => {
    await worker?.stop({ force: true });
    worker = undefined;
  });

  function startWorker(adapter: ProviderAdapter, policy = new FakeEffectivePolicySource()) {
    const c = api.c;
    worker = createWorker({
      db: api.database.db,
      dispatcher: c.dispatcher,
      workerId: 'w-e2e',
      slots: 4,
      apiPort: 4870,
      events: c.events,
      audit: c.ports.audit,
      tasks: c.tasks,
      runs: c.runs,
      usage: c.usage,
      agents: c.agents,
      accounts: c.accounts,
      policy,
      skills: new FakeEffectiveSkillsSource(),
      adapterFor: () => adapter,
      pollIntervalMs: 20,
      retryDelayMs: 30,
      runsRoot: mkdtempSync(join(tmpdir(), 'ab-mcp-')),
    });
    return worker.start();
  }

  const tick = () => api.c.orchestrator.tick(api.database.db, api.c.dispatcher);

  it('plans two subtasks, resumes the leader with their results and completes the goal', async () => {
    const s = await seed();
    const policy = new FakeEffectivePolicySource(openPolicy({ maxMode: 'edit' }));
    policy.byAgent.set(s.leader.id, s.policy);
    const { c } = api;
    const goal = await c.tasks.createTask(api.database.db, c.localUser, {
      title: 'Ship it',
      prompt: 'Ship the feature',
      workDir: '/work/repo',
      target: { agentId: s.leader.id },
      kind: 'goal',
    });
    const keys: string[] = [];
    const adapter = new ScriptedAdapter(async (spec, mcp) => {
      if (spec.agentId === s.leader.id && !spec.resumeSessionId) {
        expect(spec.systemPrompt).toContain('complete_goal');
        for (const [title, agent] of [
          ['API', s.w1],
          ['UI', s.w2],
        ] as const) {
          const r = await mcp('create_subtask', {
            title,
            prompt: `Do ${title}`,
            workDir: '/work/repo',
            target: { agentId: agent.id },
          });
          expect(r.result?.isError).toBeUndefined();
          keys.push((JSON.parse(textOf(r)) as { key: string }).key);
        }
        await mcp('post_note', { text: 'delegated two subtasks' });
        return [
          { kind: 'session', sessionId: 'leader-sess' },
          { kind: 'text', text: 'delegated' },
        ];
      }
      if (spec.agentId === s.leader.id) {
        const list = await mcp('list_subtasks', {});
        expect(textOf(list)).toContain('worker output');
        const done = await mcp('complete_goal', { summary: 'shipped', outcome: 'success' });
        expect(done.result?.isError).toBeUndefined();
        return [{ kind: 'text', text: 'done' }];
      }
      return [{ kind: 'text', text: `worker output ${spec.prompt}` }];
    });
    await startWorker(adapter, policy);

    const state = async () => c.tasks.getGoalState(api.database.db, c.orgId, goal.id);
    await waitFor(async () => (await state())?.status === 'waiting');
    const tree = (await c.tasks.getTaskTree(api.database.db, c.localUser, goal.id)).tasks;
    await waitFor(async () => {
      const t = (await c.tasks.getTaskTree(api.database.db, c.localUser, goal.id)).tasks;
      return t.filter((x) => x.id !== goal.id).every((x) => x.status === 'done');
    });
    expect(tree.filter((t) => t.id !== goal.id).map((t) => t.key)).toEqual(keys);

    await waitFor(async () => {
      await tick();
      return (await state())?.status === 'completed';
    });
    const final = await state();
    expect(final).toMatchObject({ status: 'completed', outcome: 'success', round: 2 });

    const leaderSpecs = adapter.specs.filter((x) => x.agentId === s.leader.id);
    expect(leaderSpecs).toHaveLength(2);
    expect(leaderSpecs[0]?.resumeSessionId).toBeUndefined();
    expect(leaderSpecs[1]?.resumeSessionId).toBe('leader-sess');
    expect(adapter.specs.filter((x) => x.agentId !== s.leader.id).every((x) => !x.mcpConfigPath)).toBe(true);
    const cfg = JSON.parse(adapter.configs[0] ?? '{}') as {
      mcpServers: { agent_band: { url: string; headers: Record<string, string> } };
    };
    expect(cfg.mcpServers.agent_band.url).toBe('http://127.0.0.1:4870/api/v1/mcp');
    expect(cfg.mcpServers.agent_band.headers[RUN_ID_HEADER]).toBe(leaderSpecs[0]?.runId);

    const audit = await c.audit.listAudit(api.database.db, c.localUser, { limit: 200 });
    const byAction = (a: string) => audit.items.filter((e) => e.action === a);
    expect(byAction('delegation.create_subtask')).toHaveLength(2);
    expect(byAction('delegation.complete_goal')).toHaveLength(1);
    for (const e of [...byAction('delegation.create_subtask'), ...byAction('delegation.complete_goal')])
      expect(e.actorId).toBe(s.leader.id);
  });

  it('retries a failed resume once with a fresh session', async () => {
    const s = await seed();
    const policy = new FakeEffectivePolicySource(openPolicy({ maxMode: 'edit' }));
    policy.byAgent.set(s.leader.id, s.policy);
    const { c } = api;
    const goal = await c.tasks.createTask(api.database.db, c.localUser, {
      title: 'Goal',
      prompt: 'Go',
      workDir: '/work/repo',
      target: { agentId: s.leader.id },
      kind: 'goal',
    });
    const adapter = new ScriptedAdapter((spec, mcp) => {
      if (spec.agentId !== s.leader.id) return Promise.resolve([{ kind: 'text', text: 'ok' }]);
      if (spec.resumeSessionId) {
        return Promise.resolve([{ kind: 'error', message: 'No conversation found with session ID' }]);
      }
      if (adapter.specs.filter((x) => x.agentId === s.leader.id).length === 1) {
        return mcp('create_subtask', {
          title: 'T',
          prompt: 'p',
          workDir: '/work/repo',
          target: { agentId: s.w1.id },
        }).then(() => [
          { kind: 'session', sessionId: 'old' },
          { kind: 'text', text: 'planned' },
        ]);
      }
      return mcp('complete_goal', { summary: 'fine', outcome: 'success' }).then(() => [
        { kind: 'text', text: 'done' },
      ]);
    });
    // The failing resume ends with a non-zero exit, as the Claude CLI does.
    const start = adapter.start.bind(adapter);
    adapter.start = (spec) => {
      const h = start(spec);
      if (!spec.resumeSessionId) return h;
      return { ...h, done: h.done.then(() => ({ exitCode: 1 })) };
    };
    await startWorker(adapter, policy);
    await waitFor(async () => {
      await tick();
      return (await c.tasks.getGoalState(api.database.db, c.orgId, goal.id))?.status === 'completed';
    });
    const leaderSpecs = adapter.specs.filter((x) => x.agentId === s.leader.id);
    expect(leaderSpecs.map((x) => x.resumeSessionId)).toEqual([undefined, 'old', undefined]);
  });

  it('denies a goal for a Codex leader at admission', async () => {
    const { c } = api;
    const db = api.database.db;
    const account = await c.accounts.createAccount(db, c.localUser, {
      name: 'codex',
      provider: 'openai',
      type: 'cli',
      limits: { maxConcurrentRuns: 2 },
    });
    const leader = await c.agents.createAgent(db, c.localUser, {
      slug: 'cx',
      name: 'cx',
      accountId: account.id,
      role: 'leader',
    });
    const goal = await c.tasks.createTask(db, c.localUser, {
      title: 'Goal',
      prompt: 'Go',
      workDir: '/work/repo',
      target: { agentId: leader.id },
      kind: 'goal',
    });
    const adapter = new ScriptedAdapter(() => Promise.resolve([]));
    await startWorker(adapter);
    const task = await waitFor(async () => {
      const t = (await c.tasks.listTasks(db, c.localUser)).find((x) => x.id === goal.id);
      return t?.status === 'denied' ? t : undefined;
    });
    expect(task.error).toContain('leader agents are not supported on provider openai yet');
    expect(adapter.specs).toHaveLength(0);
  });
});
