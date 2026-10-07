import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import type { BoardDataSource } from '../../data/source.ts';
import { formatClock } from '../../lib/schedule.ts';
import { BoardScreen } from './BoardScreen.tsx';

function setup() {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const spies = {
    createTask: vi.fn((...a: Parameters<BoardDataSource['createTask']>) => mock.createTask(...a)),
    startTasks: vi.fn((...a: Parameters<BoardDataSource['startTasks']>) => mock.startTasks(...a)),
    updateTask: vi.fn((...a: Parameters<BoardDataSource['updateTask']>) => mock.updateTask(...a)),
    deleteTask: vi.fn((...a: Parameters<BoardDataSource['deleteTask']>) => mock.deleteTask(...a)),
    approvePlan: vi.fn((...a: Parameters<BoardDataSource['approvePlan']>) => mock.approvePlan(...a)),
    rejectPlan: vi.fn((...a: Parameters<BoardDataSource['rejectPlan']>) => mock.rejectPlan(...a)),
    addPlanTask: vi.fn((...a: Parameters<BoardDataSource['addPlanTask']>) => mock.addPlanTask(...a)),
  };
  const source: BoardDataSource = { ...mock, ...spies };
  render(
    <DataSourceProvider source={source}>
      <BoardScreen />
    </DataSourceProvider>,
  );
  return spies;
}

const card = (key: string) => screen.getByRole('article', { name: new RegExp(`^${key} `) });
const column = (name: string) => screen.getByRole('region', { name });
const ready = () => screen.findByRole('article', { name: /^AB-50 / });

describe('Backlog column', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is the first column and holds drafts and proposed subtasks', async () => {
    setup();
    await ready();
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names[0]).toBe('Backlog');
    expect(within(column('Backlog')).getAllByRole('article')).toHaveLength(6);
  });

  it('offers a checkbox only on tasks that can be started directly', async () => {
    setup();
    await ready();
    expect(within(card('AB-50')).getByRole('checkbox', { name: 'Select AB-50' })).toBeInTheDocument();
    expect(within(card('AB-61')).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(card('AB-61')).getByText('Proposed by Ada')).toBeInTheDocument();
  });

  it('starts several selected tasks at once', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(within(card('AB-50')).getByRole('checkbox'));
    fireEvent.click(within(card('AB-52')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Start selected (2)' }));
    const dialog = screen.getByRole('dialog', { name: 'Start tasks' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(spies.startTasks).toHaveBeenCalledTimes(1);
    });
    const [ids, when] = spies.startTasks.mock.calls[0] ?? [];
    expect(ids).toHaveLength(2);
    expect(when).toEqual({ mode: 'now' });
    await waitFor(() => {
      expect(within(column('Queued')).getByRole('article', { name: /^AB-50 / })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Start selected/ })).not.toBeInTheDocument();
  });

  it('starts a single task from its menu at a chosen time', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(within(card('AB-51')).getByRole('button', { name: 'Actions for AB-51' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start' }));
    const dialog = screen.getByRole('dialog', { name: 'Start tasks' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Start at a chosen time/ }));
    const start = within(dialog).getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    const local = new Date(Date.now() + 2 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const value = `${String(local.getFullYear())}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value } });
    fireEvent.click(start);
    await waitFor(() => {
      expect(spies.startTasks).toHaveBeenCalledWith(['task-ab-51'], {
        mode: 'at',
        at: new Date(value).toISOString(),
      });
    });
    await waitFor(() => {
      expect(within(column('Scheduled')).getByRole('article', { name: /^AB-51 / })).toBeInTheDocument();
    });
  });

  it('starts when the account limit window resets and says so on the card', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(within(card('AB-50')).getByRole('button', { name: 'Actions for AB-50' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start' }));
    const dialog = screen.getByRole('dialog', { name: 'Start tasks' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /limit window resets/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(spies.startTasks).toHaveBeenCalledWith(['task-ab-50'], { mode: 'limit_reset' });
    });
    const scheduled = await within(column('Scheduled')).findByRole('article', { name: /^AB-50 / });
    expect(within(scheduled).getByText(/^starts after limit reset at /)).toBeInTheDocument();
    const time = scheduled.querySelector('time');
    expect(time?.textContent).toContain(formatClock(time?.getAttribute('datetime') ?? ''));
  });

  it('edits a draft from the details panel', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(within(card('AB-52')).getByRole('button', { name: 'Actions for AB-52' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit AB-52' });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Triage flaky tests' } });
    fireEvent.change(within(dialog).getByLabelText(/^Priority/), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(spies.updateTask).toHaveBeenCalledTimes(1);
    });
    expect(spies.updateTask.mock.calls[0]?.[0]).toBe('task-ab-52');
    expect(spies.updateTask.mock.calls[0]?.[1]).toMatchObject({ title: 'Triage flaky tests', priority: 0 });
    await screen.findByRole('article', { name: /^AB-52 Triage flaky tests/ });
  });

  it('deletes a draft after confirmation', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(within(card('AB-51')).getByRole('button', { name: 'Actions for AB-51' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(spies.deleteTask).toHaveBeenCalledWith('task-ab-51');
    });
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: /^AB-51 / })).not.toBeInTheDocument();
    });
  });
});

describe('New task form', () => {
  it('adds to the backlog by default without asking for a folder', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByText(/Advanced: use an existing project folder/)).toBeInTheDocument();
    expect(within(dialog).getByText(/must be allowed by the agent's effective policy/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Backlog me' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Do it later' } });
    fireEvent.change(within(dialog).getByLabelText('Target type'), { target: { value: 'label' } });
    fireEvent.change(within(dialog).getByLabelText(/^Label/), { target: { value: 'backend' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to backlog' }));
    await waitFor(() => {
      expect(spies.createTask).toHaveBeenCalledTimes(1);
    });
    const task = spies.createTask.mock.calls[0]?.[0];
    expect(task).toMatchObject({ title: 'Backlog me', draft: true });
    expect(task).not.toHaveProperty('workDir');
    await screen.findByRole('article', { name: /^AB-1\d\d Backlog me/ });
  });

  it('creates a goal that requires plan approval by default', async () => {
    const spies = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'goal' } });
    const approval = within(dialog).getByRole('checkbox', { name: /Require plan approval/ });
    expect(approval).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Big goal' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Ship it' } });
    const agents = within(dialog).getByLabelText(/^Agent/);
    expect([...agents.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Select an agent',
      'Ada',
    ]);
    fireEvent.change(agents, { target: { value: 'ag-ada' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and start' }));
    await waitFor(() => {
      expect(spies.createTask).toHaveBeenCalled();
    });
    expect(spies.createTask.mock.calls[0]?.[0]).toMatchObject({
      kind: 'goal',
      approval: 'required',
      draft: false,
    });
  });
});

describe('Plan review', () => {
  async function openGoal() {
    const spies = setup();
    await ready();
    expect(within(card('AB-60')).getByText('Plan awaiting approval')).toBeInTheDocument();
    fireEvent.click(card('AB-60'));
    const panel = await screen.findByRole('complementary', { name: /details/ });
    return { spies, panel };
  }

  it('lists the proposed subtasks with assignee and dependencies', async () => {
    const { panel } = await openGoal();
    const review = within(panel).getByRole('region', { name: 'Plan review' });
    expect(within(review).getAllByRole('listitem')).toHaveLength(3);
    expect(within(review).getByText('Extract billing types into packages/contracts')).toBeInTheDocument();
    expect(
      within(review).getByText('Depends on: Extract billing types into packages/contracts'),
    ).toBeInTheDocument();
    expect(within(review).getByText('Assignee: Margaret')).toBeInTheDocument();
  });

  it('approves the plan choosing when to start', async () => {
    const { spies, panel } = await openGoal();
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve plan' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /limit window resets/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and start' }));
    await waitFor(() => {
      expect(spies.approvePlan).toHaveBeenCalledWith('task-ab-60', { mode: 'limit_reset' });
    });
    await waitFor(() => {
      expect(within(column('Backlog')).queryByRole('article', { name: /^AB-61 / })).not.toBeInTheDocument();
    });
    expect(within(column('Scheduled')).getByRole('article', { name: /^AB-61 / })).toBeInTheDocument();
  });

  it('requests changes with feedback', async () => {
    const { spies, panel } = await openGoal();
    fireEvent.click(within(panel).getByRole('button', { name: 'Request changes' }));
    const send = within(panel).getByRole('button', { name: 'Send feedback' });
    expect(send).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText('Feedback for the leader'), {
      target: { value: 'Split the migration in two steps' },
    });
    fireEvent.click(send);
    await waitFor(() => {
      expect(spies.rejectPlan).toHaveBeenCalledWith('task-ab-60', 'Split the migration in two steps');
    });
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: /^AB-61 / })).not.toBeInTheDocument();
    });
  });

  it('removes a subtask from the plan and adds another', async () => {
    const { spies, panel } = await openGoal();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove AB-63' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(spies.deleteTask).toHaveBeenCalledWith('task-ab-63');
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add subtask' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Extra step' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Do extra' } });
    fireEvent.change(within(dialog).getByLabelText(/^Agent/), { target: { value: 'ag-linus' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to backlog' }));
    await waitFor(() => {
      expect(spies.addPlanTask).toHaveBeenCalledTimes(1);
    });
    expect(spies.addPlanTask.mock.calls[0]?.[0]).toBe('task-ab-60');
  });
});
