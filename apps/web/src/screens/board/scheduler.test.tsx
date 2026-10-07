import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import type { BoardDataSource } from '../../data/source.ts';
import type { NewTask } from '../../data/types.ts';
import { formatClock } from '../../lib/schedule.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { validateNewTask } from './NewTaskForm.tsx';

function setup() {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const createTask = vi.fn((task: NewTask) => mock.createTask(task));
  const source: BoardDataSource = { ...mock, createTask };
  render(
    <DataSourceProvider source={source}>
      <BoardScreen />
    </DataSourceProvider>,
  );
  return { createTask };
}

const column = (name: string) => screen.getByRole('region', { name });

describe('Board scheduler support', () => {
  it('renders the Scheduled column before Queued with run times', async () => {
    setup();
    const card = await screen.findByRole('article', { name: /^AB-41 / });
    const scheduled = column('Scheduled');
    expect(within(scheduled).getAllByRole('article')).toHaveLength(2);
    expect(within(scheduled).getByText(/^Runs in 3h/)).toBeInTheDocument();
    expect(card.querySelector('time')?.getAttribute('title')).toBeTruthy();
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names.indexOf('Scheduled')).toBeLessThan(names.indexOf('Queued'));
    const strip = screen.getByRole('navigation', { name: 'Board columns' });
    expect(within(strip).getByRole('button', { name: /^Scheduled/ })).toBeInTheDocument();
  });

  it('shows the resume time and attempt on rate-limited cards', async () => {
    setup();
    const card = await screen.findByRole('article', { name: /^AB-26 / });
    const resumeAt = new Date(Date.now() + 42 * 60_000).toISOString();
    expect(card).toHaveTextContent(/Resumes at \d{2}:\d{2} \(attempt 2\/3\)/);
    expect(formatClock(resumeAt)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('cancels a scheduled task from the card menu', async () => {
    setup();
    const card = await screen.findByRole('article', { name: /^AB-41 / });
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for AB-41' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    await waitFor(() => {
      expect(within(column('Scheduled')).queryByRole('article', { name: /^AB-41 / })).not.toBeInTheDocument();
    });
  });

  it('offers cancel for rate-limited cards', async () => {
    setup();
    const card = await screen.findByRole('article', { name: /^AB-26 / });
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for AB-26' }));
    expect(within(card).getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('submits a new task with runAt and maxAttempts', async () => {
    const { createTask } = setup();
    await screen.findByRole('article', { name: /^AB-31 / });
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Later' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Do it' } });
    fireEvent.change(within(dialog).getByLabelText(/^Project folder/), { target: { value: '/w' } });
    fireEvent.change(within(dialog).getByLabelText('Target type'), { target: { value: 'label' } });
    fireEvent.change(within(dialog).getByLabelText(/^Label/), { target: { value: 'gpu' } });

    fireEvent.change(within(dialog).getByLabelText(/^Run at/), { target: { value: '2020-01-01T10:00' } });
    expect(within(dialog).getByRole('button', { name: 'Create and start' })).toBeEnabled();
    fireEvent.blur(within(dialog).getByLabelText(/^Run at/));
    expect(within(dialog).getByText('Run at must be in the future.')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();

    const local = '2099-03-04T10:30';
    fireEvent.change(within(dialog).getByLabelText(/^Run at/), { target: { value: local } });
    fireEvent.change(within(dialog).getByLabelText(/^Max attempts/), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and start' }));
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith({
        title: 'Later',
        prompt: 'Do it',
        workDir: '/w',
        target: { type: 'label', label: 'gpu' },
        priority: 2,
        runAt: new Date(local).toISOString(),
        maxAttempts: 5,
        draft: false,
      });
    });
  });

  it('validates max attempts', () => {
    const base = {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      targetType: 'label',
      agentId: '',
      label: 'x',
      groupId: '',
    } as const;
    expect(validateNewTask({ ...base, maxAttempts: 21 })).toMatch(/1 to 20/);
    expect(validateNewTask({ ...base, maxAttempts: 0 })).toMatch(/1 to 20/);
    expect(validateNewTask({ ...base, maxAttempts: 20 })).toBeNull();
  });
});
