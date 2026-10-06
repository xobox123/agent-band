import { describe, expect, it, vi } from 'vitest';
import type { EventsClient, ServerEvent } from '../api/events.ts';
import { ID, accountDto, agentDto, list, runDto, taskDto, testApi } from '../test-utils.tsx';
import { createLiveDataSource } from './live.ts';
import { emptyFilter } from './source.ts';

const board = (queued: unknown[]) => ({
  cursor: 12,
  columns: { queued, running: [], rate_limited: [], done: [], failed: [], cancelled: [] },
});

function setup(events?: EventsClient) {
  const { api, calls } = testApi({
    'GET /board': board([
      taskDto(),
      taskDto({
        id: ID(31),
        key: 'AB-2',
        title: 'Label task',
        target: { label: 'gpu' },
        error: 'No enabled agent carries the label',
      }),
    ]),
    'GET /agents': list([agentDto()]),
    'GET /accounts': list([accountDto()]),
    'GET /agent-groups': list([]),
    'GET /runs': list([
      runDto({ id: ID(40), startedAt: '2026-10-06T09:00:00.000Z' }),
      runDto({ id: ID(41), startedAt: '2026-10-06T10:00:00.000Z' }),
    ]),
    'GET /dashboard': {
      cursor: 12,
      accounts: [
        {
          account: accountDto(),
          windows: [],
          tokensToday: 4200,
          cachedTokensToday: 0,
          runningRuns: 1,
          blockedUntil: null,
        },
      ],
      agents: [{ agent: agentDto(), status: 'running', runningRunId: ID(41), tokensToday: 0 }],
      runningRuns: [],
      queuedCount: 2,
      tokensToday: 4200,
      cachedTokensToday: 0,
    },
    'POST /tasks': taskDto(),
    'POST /tasks/00000000-0000-4000-8000-000000000030/cancel': taskDto({ status: 'cancelled' }),
  });
  const stub: EventsClient = events ?? {
    subscribe: () => () => undefined,
    onState: () => () => undefined,
    state: () => 'connected',
  };
  return { source: createLiveDataSource(api, stub, 0), calls };
}

describe('live board data source', () => {
  it('maps DTOs into the board snapshot', async () => {
    const { source } = setup();
    const snap = await source.load(emptyFilter);
    expect(snap.cursor).toBe('12');
    const [first, label] = snap.tasks;
    expect(first?.target).toEqual({ type: 'agent', agentId: ID(1) });
    expect(first?.runId).toBe(ID(41));
    expect(label?.target).toEqual({ type: 'label', label: 'gpu' });
    expect(label?.noEligibleReason).toBe('No enabled agent carries the label');
    expect(snap.agents[0]).toMatchObject({ status: 'running', runningRunId: ID(41), model: 'claude-opus' });
    expect(snap.accounts[0]).toMatchObject({
      provider: 'claude',
      dailyTokenBudget: 1_000_000,
      tokensToday: 4200,
    });
  });

  it('applies filters client side and sends mutations to the API', async () => {
    const { source, calls } = setup();
    const filtered = await source.load({ ...emptyFilter, label: 'gpu' });
    expect(filtered.tasks.map((t) => t.key)).toEqual(['AB-2']);

    await source.createTask({
      title: 'T',
      prompt: 'P',
      workDir: '/w',
      target: { type: 'group', agentGroupId: ID(5) },
      priority: 1,
      mode: 'edit',
    });
    expect(calls.find((c) => c.path === '/tasks' && c.method === 'POST')?.body).toEqual({
      title: 'T',
      prompt: 'P',
      workDir: '/w',
      target: { agentGroupId: ID(5) },
      priority: 1,
      mode: 'edit',
    });
    await source.cancel(ID(30));
    expect(calls.some((c) => c.path === `/tasks/${ID(30)}/cancel`)).toBe(true);
  });

  it('notifies subscribers about board events and ignores unrelated ones', () => {
    let push: (e: ServerEvent) => void = () => undefined;
    const events: EventsClient = {
      subscribe: (fn) => {
        push = fn;
        return () => undefined;
      },
      onState: () => () => undefined,
      state: () => 'connected',
    };
    vi.useFakeTimers();
    const { source } = setup(events);
    const seen = vi.fn();
    source.subscribe(seen);
    push({ type: 'policy.updated', id: '1', data: null });
    push({ type: 'task.updated', id: '2', data: null });
    vi.advanceTimersByTime(10);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ cursor: '2' });
    vi.useRealTimers();
  });
});
