import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ID, list, NOW, Providers, taskDto, testApi } from '../../test-utils.tsx';
import type { Routes } from '../../test-utils.tsx';
import { ProjectsScreen } from './ProjectsScreen.tsx';

const project = (over: Record<string, unknown> = {}) => ({
  id: ID(60),
  orgId: ID(100),
  name: 'agent-band',
  slug: 'agent-band',
  repoPath: '/repos/agent-band',
  defaultBranch: 'main',
  worktreesRoot: '/ws/agent-band/worktrees',
  checks: ['npm run lint', 'npm test'],
  keepWorktrees: false,
  createdBy: ID(200),
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const review = (status: string) => ({
  status,
  checks: [],
  diffStat: { files: 1, additions: 2, deletions: 0 },
  commits: [],
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
});

function routes(extra: Routes = {}): Routes {
  return {
    'GET /projects': list([project()]),
    'GET /policies': list([{ id: ID(70), name: 'Default', description: '', currentVersion: 1 }]),
    'GET /tasks': list([
      taskDto({ id: ID(31), key: 'AB-31', title: 'Open one', status: 'running', projectId: ID(60) }),
      taskDto({
        id: ID(32),
        key: 'AB-32',
        title: 'Merged one',
        status: 'done',
        projectId: ID(60),
        review: review('merged'),
      }),
      taskDto({
        id: ID(33),
        key: 'AB-33',
        title: 'Needs a look',
        status: 'done',
        projectId: ID(60),
        review: review('pending'),
      }),
    ]),
    ...extra,
  };
}

function setup(r: Routes) {
  const { api, calls } = testApi(r);
  render(
    <Providers api={api}>
      <ProjectsScreen />
    </Providers>,
  );
  return calls;
}

describe('Projects screen', () => {
  it('lists projects and shows open tasks, reviews and recent merges in the details', async () => {
    setup(routes());
    const table = await screen.findByRole('table', { name: 'Projects' });
    const row = within(table).getByRole('row', { name: /agent-band/ });
    expect(within(row).getByText('/repos/agent-band')).toBeInTheDocument();
    fireEvent.click(row);
    const panel = await screen.findByRole('complementary', { name: 'agent-band details' });
    expect(within(panel).getByText('npm run lint')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /AB-31 Open one/ })).toHaveAttribute(
      'href',
      `#/board?task=${ID(31)}`,
    );
    expect(within(panel).getByRole('link', { name: /AB-32 Merged one/ })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /AB-33 Needs a look/ })).toBeInTheDocument();
  });

  it('asks only for the tasks of the project', async () => {
    const calls = setup(routes());
    await screen.findByRole('table', { name: 'Projects' });
    expect(calls.find((c) => c.path === '/tasks')?.query).toMatchObject({ projectId: ID(60) });
  });

  it('adds the worktrees folder to a chosen policy', async () => {
    const calls = setup(
      routes({
        [`POST /projects/${ID(60)}/allow-agents`]: {
          policyId: ID(70),
          added: true,
          workDirs: ['/ws/agent-band/worktrees'],
        },
      }),
    );
    fireEvent.click(await screen.findByRole('row', { name: /agent-band/ }));
    const panel = await screen.findByRole('complementary', { name: 'agent-band details' });
    const button = within(panel).getByRole('button', { name: 'Allow agents to work in this project' });
    expect(button).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText('Policy'), { target: { value: ID(70) } });
    fireEvent.click(button);
    expect(await screen.findByText('Added to the policy.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ policyId: ID(70) });
  });

  it('validates the repository path while typing and creates the project', async () => {
    const calls = setup(
      routes({
        'GET /projects': list([]),
        'GET /projects/validate': (_init: RequestInit, url: URL) =>
          url.searchParams.get('path') === '/repos/ok'
            ? { valid: true, defaultBranch: 'trunk', reason: null }
            : { valid: false, defaultBranch: null, reason: 'not a git repository' },
        'POST /projects': project({ id: ID(61), name: 'New', slug: 'new', repoPath: '/repos/ok' }),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create project' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: 'New' } });
    const path = within(dialog).getByRole('textbox', { name: /^Repository path/ });
    fireEvent.change(path, { target: { value: '/repos/bad' } });
    expect(await within(dialog).findByText('not a git repository')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(within(dialog).getByText('Missing: Repository path')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(path, { target: { value: '/repos/ok' } });
    expect(await within(dialog).findByText(/Default branch: trunk/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Checks/ }), {
      target: { value: 'npm test\n\n  npm run lint  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST' && c.path === '/projects')?.body).toEqual({
        name: 'New',
        repoPath: '/repos/ok',
        checks: ['npm test', 'npm run lint'],
        keepWorktrees: false,
      });
    });
  });
});
