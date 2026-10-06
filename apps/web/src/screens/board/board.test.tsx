import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import type { BoardDataSource } from '../../data/source.ts';
import type { NewTask, Priority } from '../../data/types.ts';
import { evaluateDrop } from './dnd.ts';
import { BoardScreen } from './BoardScreen.tsx';

function setup() {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const spies = {
    reorder: vi.fn((id: string, before: string | null) => mock.reorder(id, before)),
    setPriority: vi.fn((id: string, p: Priority) => mock.setPriority(id, p)),
    cancel: vi.fn((id: string) => mock.cancel(id)),
    createTask: vi.fn((task: NewTask) => mock.createTask(task)),
  };
  const source: BoardDataSource = {
    load: (f) => mock.load(f),
    subscribe: (fn) => mock.subscribe(fn),
    ...spies,
  };
  render(
    <DataSourceProvider source={source}>
      <BoardScreen />
    </DataSourceProvider>,
  );
  return spies;
}

const card = (key: string) => screen.getByRole('article', { name: new RegExp(`^${key} `) });
const column = (name: string) => screen.getByRole('region', { name });

async function ready() {
  await screen.findByRole('article', { name: /^AB-31 / });
}

function drag(from: HTMLElement, to: HTMLElement) {
  fireEvent.dragStart(from);
  fireEvent.dragOver(to);
  fireEvent.drop(to);
}

describe('Board', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all columns from the snapshot', async () => {
    setup();
    await ready();
    for (const name of ['Queued', 'Running', 'Rate limited', 'Done', 'Failed / Denied', 'Cancelled']) {
      expect(column(name)).toBeInTheDocument();
    }
    expect(within(column('Queued')).getAllByRole('article')).toHaveLength(7);
    expect(within(column('Running')).getAllByRole('article')).toHaveLength(3);
    expect(within(column('Failed / Denied')).getAllByRole('article')).toHaveLength(2);
    expect(within(column('Done')).getAllByRole('article')).toHaveLength(2);
    expect(within(column('Rate limited')).getAllByRole('article')).toHaveLength(1);
  });

  it('keeps Cancelled collapsed with its count and expands on click', async () => {
    setup();
    await ready();
    const cancelled = column('Cancelled');
    expect(within(cancelled).queryByRole('article')).not.toBeInTheDocument();
    expect(within(cancelled).getByLabelText('1 tasks')).toBeInTheDocument();
    fireEvent.click(within(cancelled).getByRole('button', { name: 'Expand' }));
    expect(within(cancelled).getByRole('article', { name: /^AB-20 / })).toBeInTheDocument();
  });

  it('shows card anatomy including the no eligible agent state', async () => {
    setup();
    await ready();
    const noAgent = card('AB-35');
    expect(within(noAgent).getByText('No eligible agent')).toBeInTheDocument();
    expect(within(noAgent).getByText('No enabled agent carries the label "gpu".')).toBeInTheDocument();
    expect(within(noAgent).getByText('Label: gpu')).toBeInTheDocument();
    expect(within(card('AB-28')).getByRole('img', { name: 'Ada' })).toBeInTheDocument();
    expect(within(card('AB-30')).getByText('Claimed')).toBeInTheDocument();
    expect(within(card('AB-31')).getByText('Not started')).toBeInTheDocument();
  });

  it('filters by text', async () => {
    setup();
    await ready();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'sse replay' },
    });
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: /^AB-31 / })).not.toBeInTheDocument();
    });
    expect(card('AB-28')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('shows the no matches state and clears filters', async () => {
    setup();
    await ready();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'zzzz' } });
    expect(await screen.findByText('No matches. Clear filters to see all items.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0] as HTMLElement);
    await ready();
  });

  it('filters by agent', async () => {
    setup();
    await ready();
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), { target: { value: 'ag-grace' } });
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: /^AB-31 / })).not.toBeInTheDocument();
    });
    expect(card('AB-29')).toBeInTheDocument();
    expect(card('AB-36')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('groups cards into swimlanes by agent', async () => {
    setup();
    await ready();
    fireEvent.change(screen.getByRole('combobox', { name: 'Swimlanes' }), { target: { value: 'agent' } });
    expect(screen.getByRole('region', { name: 'Lane Ada' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Lane Unassigned targets' })).toBeInTheDocument();
  });

  it('reorders inside a priority band through the data source', async () => {
    const source = setup();
    await ready();
    drag(card('AB-37'), card('AB-34'));
    expect(source.reorder).toHaveBeenCalledWith('task-ab-37', 'task-ab-34');
    await waitFor(() => {
      const keys = within(column('Queued'))
        .getAllByRole('article')
        .map((a) => a.getAttribute('aria-label')?.split(' ')[0]);
      expect(keys.indexOf('AB-37')).toBeLessThan(keys.indexOf('AB-34'));
    });
    expect(source.setPriority).not.toHaveBeenCalled();
  });

  it('rejects cross-priority and cross-lane drops with a hint', async () => {
    const source = setup();
    await ready();
    drag(card('AB-36'), card('AB-34'));
    expect(source.reorder).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use Set priority to change priority.');
  });

  it('rejects dropping a queued task on Done', async () => {
    const source = setup();
    await ready();
    drag(card('AB-34'), column('Done'));
    expect(source.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('cancels after confirmation when dropped on Cancelled', async () => {
    const source = setup();
    await ready();
    drag(card('AB-34'), column('Cancelled'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Cancel AB-34? Work already performed will remain in its run history.');
    expect(source.cancel).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }));
    expect(source.cancel).toHaveBeenCalledWith('task-ab-34');
    await waitFor(() => {
      expect(within(column('Queued')).queryByRole('article', { name: /^AB-34 / })).not.toBeInTheDocument();
    });
  });

  it('does not cancel when the confirmation is dismissed', async () => {
    const source = setup();
    await ready();
    drag(card('AB-34'), column('Cancelled'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep task' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(source.cancel).not.toHaveBeenCalled();
  });

  it('offers priority and cancel from the card menu', async () => {
    const source = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for AB-34' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set priority P0' }));
    expect(source.setPriority).toHaveBeenCalledWith('task-ab-34', 0);
  });

  it('opens the details panel on card click and closes with Escape', async () => {
    setup();
    await ready();
    fireEvent.click(card('AB-28'));
    const panel = screen.getByRole('complementary', { name: /Implement SSE replay.* details/ });
    expect(within(panel).getByText('AB-28')).toBeInTheDocument();
    expect(within(panel).getByText(/Work on "Implement SSE replay/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('opens details with Enter on a focused card', async () => {
    setup();
    await ready();
    fireEvent.keyDown(card('AB-31'), { key: 'Enter' });
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });
});

describe('evaluateDrop', () => {
  const mk = (over: Partial<Parameters<typeof evaluateDrop>[0]>) =>
    ({ id: 't', status: 'queued', priority: 2, ...over }) as Parameters<typeof evaluateDrop>[0];

  it('applies the board rules', () => {
    const queued = mk({});
    expect(evaluateDrop(queued, 'l', { kind: 'band', priority: 2, laneKey: 'l' })).toEqual({
      kind: 'reorder',
      beforeId: null,
    });
    expect(evaluateDrop(queued, 'l', { kind: 'band', priority: 1, laneKey: 'l' }).kind).toBe('reject');
    expect(evaluateDrop(queued, 'l', { kind: 'band', priority: 2, laneKey: 'other' })).toEqual({
      kind: 'reject',
      reason: 'Dragging cannot reassign tasks.',
    });
    expect(evaluateDrop(queued, 'l', { kind: 'column', column: 'cancelled', laneKey: 'l' })).toEqual({
      kind: 'cancel',
    });
    expect(
      evaluateDrop(mk({ status: 'done' }), 'l', { kind: 'column', column: 'cancelled', laneKey: 'l' }).kind,
    ).toBe('reject');
    expect(
      evaluateDrop(mk({ status: 'failed' }), 'l', { kind: 'column', column: 'queued', laneKey: 'l' }).kind,
    ).toBe('reject');
  });
});
