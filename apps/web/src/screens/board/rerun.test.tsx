import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import { createLiveDataSource } from '../../data/live.ts';
import { createEventsClient } from '../../api/events.ts';
import { createApi } from '../../api/client.ts';
import { BoardScreen } from './BoardScreen.tsx';

function setup() {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const rerunTasks = vi.fn((...args: Parameters<typeof mock.rerunTasks>) => mock.rerunTasks(...args));
  const duplicateTask = vi.fn((id: string) => mock.duplicateTask(id));
  const load: typeof mock.load = async (filter) => {
    const snapshot = await mock.load(filter);
    return { ...snapshot, tasks: snapshot.tasks.filter((task) => ['AB-24'].includes(task.key)) };
  };
  render(
    <DataSourceProvider source={{ ...mock, load, rerunTasks, duplicateTask }}>
      <BoardScreen />
    </DataSourceProvider>,
  );
  return { rerunTasks, duplicateTask };
}

const doneCard = () => screen.getByRole('article', { name: /^AB-24 / });

describe('Run finished tasks again', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('runs selected done tasks through the start dialog', async () => {
    const { rerunTasks } = setup();
    await screen.findByLabelText('Select AB-24');
    fireEvent.click(screen.getByLabelText('Select AB-24'));
    fireEvent.click(screen.getByRole('button', { name: 'Run selected again' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run again' }));
    await waitFor(() => {
      expect(rerunTasks).toHaveBeenCalledWith([expect.any(String)], { mode: 'now' });
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Queued' })).getByRole('article', { name: /^AB-24 / }),
      ).toBeInTheDocument(),
    );
  });

  it('offers rerun and duplicate in the menu and details, and lists history', async () => {
    const { duplicateTask } = setup();
    await screen.findByRole('article', { name: /^AB-24 / });
    fireEvent.click(within(doneCard()).getByRole('button', { name: 'Actions for AB-24' }));
    expect(screen.getByRole('menuitem', { name: 'Run again' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(duplicateTask).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(doneCard());
    const panel = screen.getByRole('complementary', { name: /details/ });
    expect(within(panel).getByRole('button', { name: 'Run again' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Move to backlog' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(panel).getByRole('list').children.length).toBeGreaterThan(0);
    });
  });

  it('moves a done card to Backlog by dragging', async () => {
    setup();
    await screen.findByRole('article', { name: /^AB-24 / });
    fireEvent.dragStart(doneCard());
    fireEvent.drop(screen.getByRole('region', { name: 'Backlog' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Backlog' })).getByRole('article', { name: /^AB-24 / }),
      ).toBeInTheDocument(),
    );
  });

  it('loads every page of run history', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: 'first' }], nextCursor: 'page-two' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'second' }], nextCursor: null })));
    const source = createLiveDataSource(createApi(fetcher), createEventsClient());
    expect((await source.taskRuns('task-id')).map((run) => run.id)).toEqual(['first', 'second']);
    expect(fetcher.mock.calls[1]?.[0]).toContain('pageCursor=page-two');
  });

  it('sends an empty JSON object for a single rerun without scheduling options', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    await createApi(fetcher).tasks.rerun('task-id');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/tasks/task-id/rerun',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });
});
