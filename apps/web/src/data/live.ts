import type { Api } from '../api/client.ts';
import type { EventsClient } from '../api/events.ts';
import type { CreateTaskBody } from '@agent-band/contracts';
import { toAccount, toAgent, toGroup, toTargetDto, toTask } from './adapt.ts';
import type { NewTask } from './types.ts';
import type { BoardDataSource } from './source.ts';
import type { BoardEvent, Run } from './types.ts';

const BOARD_EVENTS = ['task.', 'run.updated', 'agent', 'account.', 'org.'];

export function createLiveDataSource(api: Api, events: EventsClient, throttleMs = 400): BoardDataSource {
  return {
    async load(filter) {
      const [board, agents, accounts, groups, dashboard, goals, org] = await Promise.all([
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
        api.goals().catch(() => ({ items: [] })),
        api.organization().catch(() => null),
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
        goals: goals.items.map((g) => ({
          rootTaskId: g.goal.rootTaskId,
          status: g.goal.status,
          approval: g.goal.approval,
          round: g.goal.round,
          leaderAgentId: g.goal.leaderAgentId,
        })),
        org: { paused: org?.paused ?? false, workspaceRoot: org?.workspaceRoot ?? '' },
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
      await api.tasks.create(toBody(task));
    },
    async startTasks(ids, when) {
      await api.tasks.start(ids, when);
    },
    async updateTask(taskId, patch) {
      await api.tasks.update(taskId, {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.prompt !== undefined && { prompt: patch.prompt }),
        ...(patch.workDir !== undefined && { workDir: patch.workDir }),
        ...(patch.target !== undefined && { target: toTargetDto(patch.target) }),
        ...(patch.priority !== undefined && { priority: patch.priority }),
        ...(patch.mode !== undefined && { mode: patch.mode }),
        ...(patch.runAt !== undefined && { runAt: patch.runAt }),
        ...(patch.maxAttempts !== undefined && { maxAttempts: patch.maxAttempts }),
        ...(patch.dependsOn !== undefined && { dependsOn: patch.dependsOn }),
      });
    },
    async deleteTask(taskId) {
      await api.tasks.remove(taskId);
    },
    async approvePlan(goalId, when) {
      await api.goalPlan.approve(goalId, when);
    },
    async rejectPlan(goalId, feedback) {
      await api.goalPlan.reject(goalId, feedback);
    },
    async addPlanTask(goalId, task) {
      await api.goalPlan.addTask(goalId, {
        title: task.title,
        prompt: task.prompt,
        target: toTargetDto(task.target),
        priority: task.priority,
        ...(task.workDir ? { workDir: task.workDir } : {}),
        ...(task.mode ? { mode: task.mode } : {}),
      });
    },
  };

  function toBody(task: NewTask): CreateTaskBody {
    return {
      title: task.title,
      prompt: task.prompt,
      target: toTargetDto(task.target),
      priority: task.priority,
      ...(task.workDir ? { workDir: task.workDir } : {}),
      ...(task.mode ? { mode: task.mode } : {}),
      ...(task.runAt ? { runAt: task.runAt } : {}),
      ...(task.maxAttempts ? { maxAttempts: task.maxAttempts } : {}),
      ...(task.draft ? { draft: true } : {}),
      ...(task.kind === 'goal' ? { kind: 'goal' as const } : {}),
      ...(task.approval ? { approval: task.approval } : {}),
    };
  }
}
