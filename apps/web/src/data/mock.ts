import { matchesFilter } from './filter.ts';
import type { BoardDataSource } from './source.ts';
import type {
  Account,
  Agent,
  AgentGroup,
  BoardEvent,
  Priority,
  Run,
  Task,
  TaskStatus,
  TaskTarget,
} from './types.ts';

export interface MockOptions {
  /** Simulated live updates every few seconds. Default true. */
  live?: boolean;
  liveIntervalMs?: number;
  /** Simulated network latency for mutations. */
  latencyMs?: number;
  now?: () => number;
}

const accounts: Account[] = [
  {
    id: 'acc-claude',
    name: 'Claude Max',
    provider: 'claude',
    dailyTokenBudget: 2_000_000,
    tokensToday: 1_240_000,
  },
  {
    id: 'acc-codex',
    name: 'Codex Pro',
    provider: 'codex',
    dailyTokenBudget: 1_000_000,
    tokensToday: 310_000,
  },
  { id: 'acc-api', name: 'Anthropic API', provider: 'api', dailyTokenBudget: null, tokensToday: 88_000 },
];

const groups: AgentGroup[] = [
  { id: 'grp-core', name: 'Core' },
  { id: 'grp-qa', name: 'QA' },
];

type AgentSeed = Omit<Agent, 'status' | 'runningRunId'>;

const agentSeeds: AgentSeed[] = [
  {
    id: 'ag-ada',
    name: 'Ada',
    handle: 'agent:ada',
    role: 'leader',
    enabled: true,
    accountId: 'acc-claude',
    model: 'claude-opus',
    labels: ['backend', 'review'],
    groupIds: ['grp-core'],
    avatar: { initials: 'AD', color: 'av-1' },
  },
  {
    id: 'ag-linus',
    name: 'Linus',
    handle: 'agent:linus',
    role: 'worker',
    enabled: true,
    accountId: 'acc-codex',
    model: null,
    labels: ['backend', 'infra'],
    groupIds: ['grp-core'],
    avatar: null,
  },
  {
    id: 'ag-grace',
    name: 'Grace',
    handle: 'agent:grace',
    role: 'worker',
    enabled: true,
    accountId: 'acc-claude',
    model: 'claude-sonnet',
    labels: ['frontend'],
    groupIds: ['grp-core'],
    avatar: { initials: 'GR', color: 'av-4' },
  },
  {
    id: 'ag-margaret',
    name: 'Margaret',
    handle: 'agent:margaret',
    role: 'reviewer',
    enabled: true,
    accountId: 'acc-api',
    model: null,
    labels: ['qa', 'review'],
    groupIds: ['grp-qa'],
    avatar: null,
  },
];

interface Seed {
  key: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  target: TaskTarget;
  agentId?: string;
  startedMinAgo?: number;
  durationMin?: number;
  tokens?: [number, number, number];
  error?: string;
  noEligible?: string;
  resetInMin?: number;
  updatedMinAgo: number;
}

const seeds: Seed[] = [
  {
    key: 'AB-31',
    title: 'Add retry with backoff to the outbox dispatcher',
    status: 'queued',
    priority: 0,
    target: { type: 'agent', agentId: 'ag-linus' },
    updatedMinAgo: 9,
  },
  {
    key: 'AB-32',
    title: 'Document the policy merge rules for operators',
    status: 'queued',
    priority: 1,
    target: { type: 'label', label: 'review' },
    updatedMinAgo: 14,
  },
  {
    key: 'AB-33',
    title: 'Port the billing export to the new contracts package',
    status: 'queued',
    priority: 1,
    target: { type: 'group', agentGroupId: 'grp-core' },
    updatedMinAgo: 20,
  },
  {
    key: 'AB-34',
    title: 'Investigate flaky PGlite migration test on CI',
    status: 'queued',
    priority: 2,
    target: { type: 'agent', agentId: 'ag-ada' },
    updatedMinAgo: 25,
  },
  {
    key: 'AB-35',
    title: 'Migrate the legacy GPU scheduler to the new queue',
    status: 'queued',
    priority: 2,
    target: { type: 'label', label: 'gpu' },
    noEligible: 'No enabled agent carries the label "gpu".',
    updatedMinAgo: 31,
  },
  {
    key: 'AB-36',
    title: 'Tidy up unused CSS tokens',
    status: 'queued',
    priority: 3,
    target: { type: 'agent', agentId: 'ag-grace' },
    updatedMinAgo: 40,
  },
  {
    key: 'AB-37',
    title: 'Write release notes for 0.2',
    status: 'queued',
    priority: 2,
    target: { type: 'label', label: 'frontend' },
    updatedMinAgo: 44,
  },
  {
    key: 'AB-28',
    title: 'Implement SSE replay with Last-Event-ID',
    status: 'running',
    priority: 0,
    target: { type: 'agent', agentId: 'ag-ada' },
    agentId: 'ag-ada',
    startedMinAgo: 18,
    tokens: [182_400, 41_200, 96_000],
    updatedMinAgo: 1,
  },
  {
    key: 'AB-29',
    title: 'Build the runs table with sticky header',
    status: 'running',
    priority: 1,
    target: { type: 'label', label: 'frontend' },
    agentId: 'ag-grace',
    startedMinAgo: 7,
    tokens: [64_000, 12_900, 20_000],
    updatedMinAgo: 1,
  },
  {
    key: 'AB-30',
    title: 'Audit chain verification for ranges',
    status: 'claimed',
    priority: 1,
    target: { type: 'agent', agentId: 'ag-linus' },
    updatedMinAgo: 1,
  },
  {
    key: 'AB-26',
    title: 'Rotate API account secrets without downtime',
    status: 'rate_limited',
    priority: 1,
    target: { type: 'agent', agentId: 'ag-margaret' },
    agentId: 'ag-margaret',
    startedMinAgo: 55,
    durationMin: 30,
    tokens: [310_000, 66_500, 140_000],
    resetInMin: 42,
    updatedMinAgo: 25,
  },
  {
    key: 'AB-24',
    title: 'Cap run duration by effective policy',
    status: 'done',
    priority: 2,
    target: { type: 'agent', agentId: 'ag-ada' },
    agentId: 'ag-ada',
    startedMinAgo: 200,
    durationMin: 36,
    tokens: [120_300, 28_100, 51_000],
    updatedMinAgo: 160,
  },
  {
    key: 'AB-25',
    title: 'Normalise work directory containment checks',
    status: 'done',
    priority: 1,
    target: { type: 'label', label: 'backend' },
    agentId: 'ag-linus',
    startedMinAgo: 330,
    durationMin: 52,
    tokens: [210_000, 54_200, 80_000],
    updatedMinAgo: 270,
  },
  {
    key: 'AB-22',
    title: 'Fix token usage double counting for cached input',
    status: 'failed',
    priority: 0,
    target: { type: 'agent', agentId: 'ag-linus' },
    agentId: 'ag-linus',
    startedMinAgo: 90,
    durationMin: 14,
    tokens: [33_000, 4_100, 12_000],
    error: 'Process exited with code 1: tests failed in usage.test.ts',
    updatedMinAgo: 76,
  },
  {
    key: 'AB-23',
    title: 'Delete production database',
    status: 'denied',
    priority: 3,
    target: { type: 'agent', agentId: 'ag-grace' },
    error: 'Denied by policy: workDir is outside the allowed roots.',
    updatedMinAgo: 120,
  },
  {
    key: 'AB-20',
    title: 'Prototype a terminal view for run logs',
    status: 'cancelled',
    priority: 3,
    target: { type: 'agent', agentId: 'ag-grace' },
    agentId: 'ag-grace',
    startedMinAgo: 400,
    durationMin: 5,
    tokens: [8_000, 900, 0],
    updatedMinAgo: 390,
  },
];

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

export function createMockDataSource(options: MockOptions = {}): BoardDataSource {
  const { live = true, liveIntervalMs = 4000, latencyMs = 250, now = Date.now } = options;
  const t0 = now();
  const agentMap = new Map(agentSeeds.map((a) => [a.id, a]));

  let tasks: Task[] = [];
  let runs: Run[] = [];
  let cursor = 1;
  let nextRank = 1;

  seeds.forEach((s, i) => {
    const id = `task-${s.key.toLowerCase()}`;
    let runId: string | null = null;
    if (s.agentId) {
      const agent = agentMap.get(s.agentId);
      if (!agent) throw new Error(`Unknown seed agent ${s.agentId}`);
      runId = `run-${s.key.toLowerCase()}`;
      const startedAt = t0 - (s.startedMinAgo ?? 0) * MIN;
      const finished = s.durationMin !== undefined ? startedAt + s.durationMin * MIN : null;
      const [input, output, cached] = s.tokens ?? [0, 0, 0];
      runs.push({
        id: runId,
        taskId: id,
        agentId: agent.id,
        accountId: agent.accountId,
        status: s.status === 'running' ? 'running' : (s.status as Run['status']),
        startedAt: iso(startedAt),
        finishedAt: finished ? iso(finished) : null,
        inputTokens: input,
        outputTokens: output,
        cachedTokens: cached,
        rateLimitResetsAt: s.resetInMin ? iso(t0 + s.resetInMin * MIN) : null,
        error: s.error ?? null,
      });
    }
    tasks.push({
      id,
      key: s.key,
      title: s.title,
      prompt: `Work on "${s.title}". Keep the change small and add tests.`,
      status: s.status,
      priority: s.priority,
      rank: nextRank++,
      target: s.target,
      workDir: '/Users/dev/agent-band',
      runId,
      error: s.error ?? null,
      noEligibleReason: s.noEligible ?? null,
      createdBy: 'user:local',
      createdAt: iso(t0 - (s.updatedMinAgo + 30 + i) * MIN),
      updatedAt: iso(t0 - s.updatedMinAgo * MIN),
    });
  });

  const listeners = new Set<(e: BoardEvent) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = () => {
    cursor += 1;
    const event = { cursor: String(cursor) };
    listeners.forEach((fn) => {
      fn(event);
    });
  };

  const delay = () =>
    latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : Promise.resolve();

  const findTask = (id: string): Task => {
    const task = tasks.find((x) => x.id === id);
    if (!task) throw new Error('This task is no longer available.');
    return task;
  };
  const replace = (next: Task) => {
    tasks = tasks.map((x) => (x.id === next.id ? next : x));
  };

  const tick = () => {
    const stamp = iso(now());
    runs = runs.map((r) =>
      r.status === 'running'
        ? {
            ...r,
            inputTokens: (r.inputTokens ?? 0) + 800 + Math.floor(Math.random() * 1500),
            outputTokens: (r.outputTokens ?? 0) + 120 + Math.floor(Math.random() * 400),
          }
        : r,
    );
    const claimed = tasks.find((x) => x.status === 'claimed');
    if (claimed && claimed.target.type === 'agent') {
      const agent = agentMap.get(claimed.target.agentId);
      if (agent) {
        const run: Run = {
          id: `run-${claimed.key.toLowerCase()}`,
          taskId: claimed.id,
          agentId: agent.id,
          accountId: agent.accountId,
          status: 'running',
          startedAt: stamp,
          finishedAt: null,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          rateLimitResetsAt: null,
          error: null,
        };
        runs.push(run);
        replace({ ...claimed, status: 'running', runId: run.id, updatedAt: stamp });
      }
    }
    emit();
  };

  return {
    load(filter) {
      const runMap = new Map(runs.map((r) => [r.id, r]));
      const filtered = tasks.filter((task) =>
        matchesFilter(task, task.runId ? runMap.get(task.runId) : undefined, agentMap, filter),
      );
      const ids = new Set(filtered.map((x) => x.id));
      return Promise.resolve(
        structuredClone({
          cursor: String(cursor),
          tasks: filtered,
          runs: runs.filter((r) => ids.has(r.taskId)),
          agents: agentSeeds.map((a) => {
            const active = runs.find((r) => r.agentId === a.id && r.status === 'running');
            return {
              ...a,
              status: !a.enabled ? 'disabled' : active ? 'running' : 'idle',
              runningRunId: active?.id ?? null,
            } satisfies Agent;
          }),
          accounts,
          groups,
        }),
      );
    },
    subscribe(fn) {
      listeners.add(fn);
      if (live && !timer) timer = setInterval(tick, liveIntervalMs);
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    async reorder(taskId, beforeId) {
      await delay();
      const task = findTask(taskId);
      if (task.status !== 'queued') throw new Error('Only queued tasks can be reordered.');
      const band = tasks
        .filter((x) => x.status === 'queued' && x.priority === task.priority && x.id !== task.id)
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
      let rank: number;
      if (beforeId === null) {
        rank = (band[band.length - 1]?.rank ?? 0) + 1;
      } else {
        const idx = band.findIndex((x) => x.id === beforeId);
        const before = band[idx];
        if (!before) throw new Error('Use Set priority to change priority.');
        const prev = band[idx - 1];
        rank = prev ? (prev.rank + before.rank) / 2 : before.rank - 1;
      }
      replace({ ...task, rank });
      emit();
    },
    async setPriority(taskId, priority) {
      await delay();
      const task = findTask(taskId);
      if (task.status !== 'queued') throw new Error('Only queued tasks can change priority.');
      replace({ ...task, priority, updatedAt: iso(now()) });
      emit();
    },
    async createTask(input) {
      await delay();
      const stamp = iso(now());
      const key = `AB-${String(100 + tasks.length)}`;
      tasks.push({
        id: `task-${key.toLowerCase()}`,
        key,
        title: input.title,
        prompt: input.prompt,
        status: 'queued',
        priority: input.priority,
        rank: nextRank++,
        target: input.target,
        workDir: input.workDir,
        runId: null,
        error: null,
        noEligibleReason: null,
        createdBy: 'user:local',
        createdAt: stamp,
        updatedAt: stamp,
      });
      emit();
    },
    async cancel(taskId) {
      await delay();
      const task = findTask(taskId);
      if (!['queued', 'claimed', 'running'].includes(task.status)) {
        throw new Error('This item changed. Review its latest state and try again.');
      }
      const stamp = iso(now());
      runs = runs.map((r) => (r.id === task.runId ? { ...r, status: 'cancelled', finishedAt: stamp } : r));
      replace({ ...task, status: 'cancelled', updatedAt: stamp });
      emit();
    },
  };
}
