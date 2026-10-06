import type { Api } from '../api/client.ts';
import type { EventsClient } from '../api/events.ts';
import { toAccount, toAgent, toGroup, toRun, toTargetDto, toTask } from './adapt.ts';
import { matchesFilter } from './filter.ts';
import type { BoardDataSource } from './source.ts';
import type { BoardEvent, Run } from './types.ts';

const BOARD_EVENTS = ['task.', 'run.updated', 'agent', 'account.', 'org.'];

export function createLiveDataSource(api: Api, events: EventsClient, throttleMs = 400): BoardDataSource {
  return {
    async load(filter) {
      const [board, agents, accounts, groups, runs, dashboard] = await Promise.all([
        api.board(),
        api.agents.list(),
        api.accounts.list(),
        api.groups.list(),
        api.runs.list(),
        api.dashboard().catch(() => null),
      ]);

      const latestRun = new Map<string, Run>();
      for (const dto of runs.items) {
        const run = toRun(dto);
        const current = latestRun.get(run.taskId);
        if (!current || run.startedAt > current.startedAt) latestRun.set(run.taskId, run);
      }
      const statusOf = new Map((dashboard?.agents ?? []).map((a) => [a.agent.id, a]));
      const tokensOf = new Map((dashboard?.accounts ?? []).map((a) => [a.account.id, a.tokensToday]));

      const agentList = agents.items.map((a) => {
        const dash = statusOf.get(a.id);
        return toAgent(a, dash?.status, dash?.runningRunId ?? null);
      });
      const agentMap = new Map(agentList.map((a) => [a.id, a]));

      const all = Object.values(board.columns).flat();
      const tasks = all
        .map((dto) => toTask(dto, latestRun.get(dto.id)?.id ?? null))
        .filter((task) => matchesFilter(task, latestRun.get(task.id), agentMap, filter));
      const ids = new Set(tasks.map((t) => t.id));
      return {
        cursor: String(board.cursor),
        tasks,
        runs: [...latestRun.values()].filter((r) => ids.has(r.taskId)),
        agents: agentList,
        accounts: accounts.items.map((a) => toAccount(a, tokensOf.get(a.id) ?? 0)),
        groups: groups.items.map(toGroup),
      };
    },

    subscribe(fn) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = events.subscribe((event) => {
        if (event.type !== 'reset' && !BOARD_EVENTS.some((p) => event.type.startsWith(p))) return;
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          const payload: BoardEvent = { cursor: event.id };
          fn(payload);
        }, throttleMs);
      });
      return () => {
        off();
        if (timer) clearTimeout(timer);
      };
    },

    async reorder(taskId, beforeId) {
      await api.tasks.reorder(taskId, beforeId);
    },
    async setPriority(taskId, priority) {
      await api.tasks.setPriority(taskId, priority);
    },
    async cancel(taskId) {
      await api.tasks.cancel(taskId);
    },
    async createTask(task) {
      await api.tasks.create({
        title: task.title,
        prompt: task.prompt,
        workDir: task.workDir,
        target: toTargetDto(task.target),
        priority: task.priority,
        ...(task.mode ? { mode: task.mode } : {}),
        ...(task.runAt ? { runAt: task.runAt } : {}),
        ...(task.maxAttempts ? { maxAttempts: task.maxAttempts } : {}),
      });
    },
  };
}
