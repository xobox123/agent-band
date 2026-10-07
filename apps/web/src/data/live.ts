import type { Api } from '../api/client.ts';
import type { EventsClient } from '../api/events.ts';
import { toAccount, toAgent, toGroup, toTargetDto, toTask } from './adapt.ts';
import type { BoardDataSource } from './source.ts';
import type { BoardEvent, Run } from './types.ts';

const BOARD_EVENTS = ['task.', 'run.updated', 'agent', 'account.', 'org.'];

export function createLiveDataSource(api: Api, events: EventsClient, throttleMs = 400): BoardDataSource {
  return {
    async load(filter) {
      const [board, agents, accounts, groups, dashboard] = await Promise.all([
        api.board({
          text: filter.text,
          agentId: filter.agentId,
          label: filter.label,
          accountId: filter.accountId,
        }),
        api.agents.list(),
        api.accounts.list(),
        api.groups.list(),
        api.dashboard().catch(() => null),
      ]);

      const statusOf = new Map((dashboard?.agents ?? []).map((a) => [a.agent.id, a]));
      const tokensOf = new Map((dashboard?.accounts ?? []).map((a) => [a.account.id, a.tokensToday]));

      const agentList = agents.items.map((a) => {
        const dash = statusOf.get(a.id);
        return toAgent(a, dash?.status, dash?.runningRunId ?? null);
      });

      const all = Object.values(board.columns).flat();
      const tasks = all.map((dto) => toTask(dto, dto.latestRun?.id ?? null));
      const runs: Run[] = all.flatMap((dto) =>
        dto.latestRun
          ? [
              {
                ...dto.latestRun,
                taskId: dto.id,
                accountId: agentList.find((a) => a.id === dto.latestRun?.agentId)?.accountId ?? '',
                cachedTokens: null,
                rateLimitResetsAt: null,
                error: null,
              },
            ]
          : [],
      );
      return {
        cursor: String(board.cursor),
        tasks,
        runs,
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
