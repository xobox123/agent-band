import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import type { BoardDataSource } from '../../data/source.ts';
import { evaluateDrop } from './dnd.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { buildLookup, viewOf } from './model.ts';

function setup() {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const toBacklog = vi.fn((ids: string[]) => mock.toBacklog(ids));
  const source: BoardDataSource = { ...mock, toBacklog };
  const load: typeof mock.load = async (filter) => {
    const snapshot = await mock.load(filter);
    return { ...snapshot, tasks: snapshot.tasks.filter((task) => ['AB-22', 'AB-23'].includes(task.key)) };
  };
  render(
    <DataSourceProvider source={{ ...source, load }}>
      <BoardScreen />
    </DataSourceProvider>,
  );
  return { toBacklog, mock };
}

const card = (key: string) => screen.getByRole('article', { name: new RegExp(`^${key} `) });
const column = (name: string) => screen.getByRole('region', { name });

describe('Move to backlog', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('moves a failed task through the card menu', async () => {
    const { toBacklog } = setup();
    await screen.findByRole('article', { name: /^AB-22 / });
    fireEvent.click(within(card('AB-22')).getByRole('button', { name: 'Actions for AB-22' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to backlog' }));
    await waitFor(() => {
      expect(toBacklog).toHaveBeenCalledWith([expect.any(String)]);
    });
    await waitFor(() => {
      expect(within(column('Backlog')).getByRole('article', { name: /^AB-22 / })).toBeInTheDocument();
    });
    expect(within(column('Failed / Denied')).queryByRole('article', { name: /^AB-22 / })).toBeNull();
  });

  it('moves a task from the details panel', async () => {
    const { toBacklog } = setup();
    await screen.findByRole('article', { name: /^AB-23 / });
    fireEvent.click(card('AB-23'));
    const panel = await screen.findByRole('complementary', { name: /details/ });
    fireEvent.click(within(panel).getByRole('button', { name: 'Move to backlog' }));
    await waitFor(() => {
      expect(toBacklog).toHaveBeenCalledTimes(1);
    });
  });

  it('moves the ticked failed and denied tasks in one call', async () => {
    const { toBacklog } = setup();
    await screen.findByRole('article', { name: /^AB-22 / });
    fireEvent.click(screen.getByLabelText('Select AB-22'));
    fireEvent.click(screen.getByLabelText('Select AB-23'));
    fireEvent.click(screen.getByRole('button', { name: 'Move selected to backlog' }));
    await waitFor(() => {
      expect(toBacklog).toHaveBeenCalledTimes(1);
    });
    expect(toBacklog.mock.calls[0]?.[0]).toHaveLength(2);
    await waitFor(() => {
      expect(within(column('Backlog')).getByRole('article', { name: /^AB-23 / })).toBeInTheDocument();
    });
  });

  it('moves a failed card dropped on the Backlog column', async () => {
    const { toBacklog } = setup();
    await screen.findByRole('article', { name: /^AB-22 / });
    fireEvent.dragStart(card('AB-22'));
    fireEvent.dragOver(column('Backlog'));
    fireEvent.drop(column('Backlog'));
    await waitFor(() => {
      expect(toBacklog).toHaveBeenCalledTimes(1);
    });
  });

  it('evaluates drops onto the backlog', async () => {
    const mock = createMockDataSource({ live: false, latencyMs: 0 });
    const snapshot = await mock.load({ text: '', agentId: null, label: null, accountId: null });
    const lookup = buildLookup(snapshot);
    const view = (key: string) => {
      const task = snapshot.tasks.find((t) => t.key === key);
      if (!task) throw new Error(key);
      return viewOf(task, lookup).task;
    };
    const target = { kind: 'column', column: 'draft', laneKey: 'l' } as const;
    expect(evaluateDrop(view('AB-22'), 'l', target)).toEqual({ kind: 'backlog' });
    expect(evaluateDrop(view('AB-23'), 'l', target)).toEqual({ kind: 'backlog' });
    expect(evaluateDrop(view('AB-20'), 'l', target)).toEqual({ kind: 'backlog' });
    expect(evaluateDrop(view('AB-31'), 'l', target).kind).toBe('reject');
    expect(evaluateDrop(view('AB-24'), 'l', target)).toEqual({ kind: 'backlog' });
  });
});
