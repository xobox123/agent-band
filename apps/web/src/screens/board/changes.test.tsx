import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toTask } from '../../data/adapt.ts';
import { ID, Providers, taskDto, testApi } from '../../test-utils.tsx';
import type { Routes } from '../../test-utils.tsx';
import { ChangesTab } from './ChangesTab.tsx';
import { reviewBadges } from './model.ts';

const review = (over: Record<string, unknown> = {}) => ({
  status: 'pending',
  checks: [
    { command: 'npm run lint', exitCode: 0, durationMs: 1200, output: 'clean' },
    { command: 'npm test', exitCode: 1, durationMs: 4300, output: '1 failed' },
  ],
  diffStat: { files: 2, additions: 3, deletions: 1 },
  commits: [{ sha: 'c'.repeat(40), subject: 'AB-5: Add feature' }],
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  ...over,
});

const task = (over: Record<string, unknown> = {}) =>
  toTask(
    taskDto({
      id: ID(30),
      key: 'AB-5',
      status: 'done',
      projectId: ID(60),
      branch: 'ab/AB-5',
      baseBranch: 'main',
      review: review(),
      ...over,
    }) as unknown as Parameters<typeof toTask>[0],
    null,
  );

const diffText = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1,2 @@',
  '-old',
  '+new',
  '+more',
  'diff --git a/b.txt b/b.txt',
  '+x',
  '',
].join('\n');

function routes(extra: Routes = {}, r = review()): Routes {
  return {
    [`GET /tasks/${ID(30)}/diff`]: {
      diff: diffText,
      truncated: false,
      files: [
        { path: 'src/a.ts', additions: 2, deletions: 1 },
        { path: 'b.txt', additions: 1, deletions: 0 },
      ],
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      review: r,
      reviewer: { taskId: ID(31), status: 'done', summary: 'Looks fine' },
    },
    ...extra,
  };
}

function setup(r: Routes, t = task()) {
  const { api, calls } = testApi(r);
  render(
    <Providers api={api}>
      <ChangesTab task={t} />
    </Providers>,
  );
  return calls;
}

describe('review badges', () => {
  it('shows check results and the review state', () => {
    expect(reviewBadges(task()).map((b) => b.text)).toEqual(['Checks failed', 'Awaiting review']);
    expect(
      reviewBadges(task({ review: review({ checks: [{ command: 'x', exitCode: 0, durationMs: 1 }] }) })).map(
        (b) => b.text,
      ),
    ).toEqual(['Checks passed', 'Awaiting review']);
    expect(reviewBadges(task({ review: review({ status: 'merged' }) })).map((b) => b.text)).toEqual([
      'Merged',
    ]);
    const conflict = reviewBadges(task({ review: review({ status: 'conflict', conflictFiles: ['a.ts'] }) }));
    expect(conflict.at(-1)).toMatchObject({ text: 'Conflict', tone: 'crit', title: 'a.ts' });
    expect(reviewBadges(task({ review: null }))).toEqual([]);
  });
});

describe('Changes tab', () => {
  it('shows the stat, checks, commits, reviewer and the diff per file', async () => {
    setup(routes());
    expect(await screen.findByText('2 files,')).toBeInTheDocument();
    expect(screen.getByText('aaaaaaa..bbbbbbb')).toBeInTheDocument();
    const checks = screen.getByRole('heading', { name: 'Checks' }).parentElement as HTMLElement;
    expect(within(checks).getByText('npm run lint')).toBeInTheDocument();
    expect(within(checks).getByText('exit 1')).toBeInTheDocument();
    expect(screen.getByText('AB-5: Add feature')).toBeInTheDocument();
    expect(screen.getByText('Looks fine')).toBeInTheDocument();
    const files = screen.getByRole('heading', { name: 'Files' }).parentElement as HTMLElement;
    expect(within(files).getByText('src/a.ts')).toBeInTheDocument();
    expect(within(files).getByText('+more')).toBeInTheDocument();
    expect(within(files).getByText('+x')).toBeInTheDocument();
  });

  it('approves and merges', async () => {
    const calls = setup(routes({ [`POST /tasks/${ID(30)}/review/approve`]: taskDto() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and merge' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/review/approve'))).toBe(true);
    });
  });

  it('sends feedback with a request for changes', async () => {
    const calls = setup(routes({ [`POST /tasks/${ID(30)}/review/reject`]: taskDto() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    const send = screen.getByRole('button', { name: 'Send feedback and requeue' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Feedback for the agent'), { target: { value: ' Add tests ' } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith('/review/reject'))?.body).toEqual({ feedback: 'Add tests' });
    });
  });

  it('asks a reviewer agent', async () => {
    const calls = setup(routes({ [`POST /tasks/${ID(30)}/review/request`]: taskDto() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask reviewer' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/review/request'))).toBe(true);
    });
  });

  it('shows a conflict and an API error, and hides decisions for merged work', async () => {
    const conflict = review({ status: 'conflict', conflictFiles: ['shared.txt'] });
    setup(routes({}, conflict), task({ review: conflict }));
    expect(await screen.findByText(/Merge conflict in shared.txt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and merge' })).toBeInTheDocument();
  });

  it('offers no decision once merged', async () => {
    const merged = review({ status: 'merged' });
    setup(routes({}, merged), task({ review: merged }));
    await screen.findByText('2 files,');
    expect(screen.queryByRole('button', { name: 'Approve and merge' })).toBeNull();
  });

  it('reports a failed approval', async () => {
    setup(
      routes({
        [`POST /tasks/${ID(30)}/review/approve`]: new Response(
          JSON.stringify({
            status: 409,
            code: 'base_dirty',
            detail: 'The repository has uncommitted changes',
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and merge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The repository has uncommitted changes');
  });
});
