import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSourceProvider } from '../../data/context.tsx';
import { createMockDataSource } from '../../data/mock.ts';
import type { BoardDataSource } from '../../data/source.ts';
import { Providers, accountDto, agentDto, list, testApi } from '../../test-utils.tsx';
import { BoardScreen } from './BoardScreen.tsx';

function setup(extraRoutes: Record<string, unknown> = {}) {
  const mock = createMockDataSource({ live: false, latencyMs: 0 });
  const createTask = vi.fn((task: Parameters<BoardDataSource['createTask']>[0]) => mock.createTask(task));
  const source: BoardDataSource = { ...mock, createTask };
  const { api } = testApi({
    'GET /agents/ag-ada': agentDto({ id: 'ag-ada', name: 'Ada' }),
    'GET /accounts': list([accountDto()]),
    'GET /agent-groups': list([]),
    'GET /policies': list([]),
    'GET /runs': list([]),
    'GET /agents/ag-ada/effective-policy': {
      workDirSets: [],
      maxMode: 'edit',
      deniedTools: [],
      sources: [],
    },
    'GET /agents/ag-ada/effective-skills': list([]),
    ...extraRoutes,
  });
  render(
    <Providers api={api}>
      <DataSourceProvider source={source}>
        <BoardScreen />
      </DataSourceProvider>
    </Providers>,
  );
  return { createTask };
}

const card = (key: string) => screen.getByRole('article', { name: new RegExp(`^${key} `) });

describe('Board new task form', () => {
  it('validates and submits a task for a label target', async () => {
    const { createTask } = setup();
    await screen.findByRole('article', { name: /^AB-31 / });
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByText('Title is required.')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Write docs' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Document the API' } });
    fireEvent.change(within(dialog).getByLabelText(/^Work directory/), {
      target: { value: 'relative/path' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByText(/absolute path/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/^Work directory/), { target: { value: '/work/repo' } });
    fireEvent.change(within(dialog).getByLabelText('Target type'), { target: { value: 'label' } });
    fireEvent.change(within(dialog).getByLabelText(/^Label/), { target: { value: 'backend' } });
    fireEvent.change(within(dialog).getByLabelText(/^Priority/), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mode/), { target: { value: 'edit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith({
        title: 'Write docs',
        prompt: 'Document the API',
        workDir: '/work/repo',
        target: { type: 'label', label: 'backend' },
        priority: 1,
        mode: 'edit',
        maxAttempts: 3,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Write docs')).toBeInTheDocument();
  });

  it('keeps the form open and shows the server error when creation fails', async () => {
    const { createTask } = setup();
    createTask.mockRejectedValueOnce(new Error('workDir is outside the allowed roots'));
    await screen.findByRole('article', { name: /^AB-31 / });
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'x' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'y' } });
    fireEvent.change(within(dialog).getByLabelText(/^Work directory/), { target: { value: '/w' } });
    fireEvent.change(within(dialog).getByLabelText('Target type'), { target: { value: 'label' } });
    fireEvent.change(within(dialog).getByLabelText(/^Label/), { target: { value: 'gpu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('outside the allowed roots');
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('x');
  });
});

describe('Board agent hover card', () => {
  it('shows model, provider and account on hover and focus', async () => {
    setup();
    await screen.findByRole('article', { name: /^AB-31 / });
    const trigger = within(card('AB-28')).getByRole('button', { name: 'Open agent Ada' });
    fireEvent.mouseEnter(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('agent:ada');
    expect(tip).toHaveTextContent('claude-opus');
    expect(tip).toHaveTextContent('claude · Claude Max');
    expect(tip).toHaveTextContent('Leader');
    expect(tip).toHaveTextContent('Running');
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('opens agent details on click without opening the task', async () => {
    setup();
    await screen.findByRole('article', { name: /^AB-31 / });
    fireEvent.click(within(card('AB-28')).getByRole('button', { name: 'Open agent Ada' }));
    expect(await screen.findByRole('complementary', { name: 'Ada details' })).toBeInTheDocument();
    expect(await screen.findByText('Careful reviewer')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /Prototype|AB-28/ })).not.toBeInTheDocument();
  });

  it('still opens task details when the card body is clicked', async () => {
    setup();
    await screen.findByRole('article', { name: /^AB-31 / });
    fireEvent.click(within(card('AB-28')).getByRole('heading', { level: 3 }));
    const details = await screen.findByRole('complementary');
    expect(details).toHaveAccessibleName(/details$/);
    expect(within(details).getByText('AB-28')).toBeInTheDocument();
  });
});
