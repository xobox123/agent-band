import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import { BoardScreen } from './BoardScreen.tsx';

function setup() {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const retargetTask = vi.fn((...args: Parameters<typeof mock.retargetTask>) => mock.retargetTask(...args));
  render(
    <DataSourceProvider source={{ ...mock, retargetTask }}>
      <BoardScreen />
    </DataSourceProvider>,
  );
  return { retargetTask };
}

describe('Reassign task', () => {
  it('opens the agent picker from the card menu and refreshes the task', async () => {
    const { retargetTask } = setup();
    const card = await screen.findByRole('article', { name: /^AB-35 / });
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for AB-35' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reassign' }));
    const dialog = screen.getByRole('dialog', { name: 'Reassign AB-35' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Reassign target type' }), {
      target: { value: 'agent' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Reassign agent' }), {
      target: { value: 'ag-linus' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    await waitFor(() => {
      expect(retargetTask).toHaveBeenCalledWith('task-ab-35', {
        type: 'agent',
        agentId: 'ag-linus',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Reassign AB-35' })).not.toBeInTheDocument();
    });
  });

  it('offers Reassign in task details for queued tasks', async () => {
    setup();
    fireEvent.click(await screen.findByRole('article', { name: /^AB-35 / }));
    const panel = screen.getByRole('complementary', { name: /details/ });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reassign' }));
    expect(screen.getByRole('dialog', { name: 'Reassign AB-35' })).toBeInTheDocument();
  });

  it('does not offer Reassign for already claimed tasks', async () => {
    setup();
    const card = await screen.findByRole('article', { name: /^AB-30 / });
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for AB-30' }));
    expect(screen.queryByRole('menuitem', { name: 'Reassign' })).not.toBeInTheDocument();
  });
});
