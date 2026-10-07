import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, NewTask } from '../../data/types.ts';
import { NewTaskForm } from './NewTaskForm.tsx';

const agent: Agent = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ada',
  handle: 'agent:ada',
  role: 'worker',
  enabled: true,
  paused: false,
  accountId: '00000000-0000-4000-8000-000000000010',
  model: null,
  labels: [],
  groupIds: [],
  avatar: null,
  status: 'idle',
  runningRunId: null,
};
const projects = [
  { id: '00000000-0000-4000-8000-000000000060', name: 'agent-band', defaultBranch: 'main' },
  { id: '00000000-0000-4000-8000-000000000061', name: 'site', defaultBranch: 'trunk' },
];

function setup() {
  const onSubmit = vi.fn<(task: NewTask) => Promise<void>>(() => Promise.resolve());
  render(
    <NewTaskForm
      agents={[agent]}
      groups={[]}
      projects={projects}
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: 'New task' });
  const fill = () => {
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Title/ }), { target: { value: 'T' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Prompt/ }), { target: { value: 'P' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Agent/ }), {
      target: { value: agent.id },
    });
  };
  return { dialog, fill, onSubmit };
}

describe('Project select in the task form', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts without a project and sends the chosen one, remembering it', async () => {
    const { dialog, fill, onSubmit } = setup();
    const select = within(dialog).getByRole('combobox', { name: 'Project' });
    expect(select).toHaveValue('');
    fill();
    fireEvent.change(select, { target: { value: projects[1]?.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to backlog' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: projects[1]?.id }));
    });
    expect(localStorage.getItem('agent-band:last-project')).toBe(projects[1]?.id);
  });

  it('preselects the last used project and keeps the folder under Advanced', () => {
    localStorage.setItem('agent-band:last-project', projects[0]?.id ?? '');
    const { dialog } = setup();
    expect(within(dialog).getByRole('combobox', { name: 'Project' })).toHaveValue(projects[0]?.id);
    expect(within(dialog).getByText('Advanced: use an existing project folder')).toBeInTheDocument();
  });

  it('omits projectId when no project is chosen', async () => {
    const { dialog, fill, onSubmit } = setup();
    fill();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to backlog' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('projectId');
  });
});
