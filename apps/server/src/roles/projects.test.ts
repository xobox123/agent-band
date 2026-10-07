import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AppError } from '../platform/errors.ts';
import { gitOut, makeRepo } from '../modules/projects/git.testkit.ts';
import { tasks as tasksTable } from '../modules/tasks/infra/schema.ts';
import type { Task } from '../modules/tasks/index.ts';
import { makeKit, waitFor } from './worker.testkit.ts';

type Kit = Awaited<ReturnType<typeof makeKit>>;
let kit: Kit;
let repo: ReturnType<typeof makeRepo>;
let worktrees: string;
let workers: { stop(o?: { force?: boolean }): Promise<void> }[] = [];

beforeEach(async () => {
  kit = await makeKit();
  repo = makeRepo();
  worktrees = join(repo.base, 'worktrees');
  workers = [];
});
afterEach(async () => {
  for (const w of workers) await w.stop({ force: true });
  await kit.close();
});

const identity = { name: 'Alpha Bot', email: 'alpha@example.com' };
const project = (extra: Record<string, unknown> = {}) =>
  kit.projects.create(kit.db, kit.actor, {
    name: 'Repo',
    repoPath: repo.dir,
    worktreesRoot: worktrees,
    checks: ['echo ok', 'echo broken >&2; exit 3'],
    ...extra,
  });
const projectTask = (projectId: string, extra: Record<string, unknown> = {}) =>
  kit.task({ projectId, workDir: undefined, title: 'Add feature', ...extra });
const startWorker = async () => {
  const w = kit.worker();
  workers.push(w);
  await w.start();
  return w;
};
const reload = async (id: string): Promise<Task> => {
  const t = await kit.taskStatus(id);
  if (!t) throw new Error('task missing');
  return t;
};
const settled = (id: string, attempt = 1) =>
  waitFor(async () => {
    const t = await reload(id);
    return t.status === 'done' && t.attempt === attempt && t.review ? t : undefined;
  }, 15_000);
/** The fake agent writes the given files into the worktree it runs in. */
const writes = (files: Record<string, string>) => {
  kit.script = (s) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(s.workDir, name), text);
    return { events: [{ kind: 'text', text: 'done' }] };
  };
};
const markDone = async (task: Task, review: NonNullable<Task['review']>) => {
  await kit.db.update(tasksTable).set({ status: 'done' }).where(eq(tasksTable.id, task.id));
  await kit.db.transaction((tx) => kit.tasks.setReview(tx, kit.actor, task.id, review));
};
const failsWith = async (p: Promise<unknown>, status: number, code?: string) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  if (code) expect((err as AppError).code).toBe(code);
};
const branches = () => gitOut(repo.dir, 'branch', '--format=%(refname:short)').split('\n');

describe('projects', () => {
  it('validates the repository path and detects the default branch', async () => {
    await failsWith(
      kit.projects.create(kit.db, kit.actor, { name: 'x', repoPath: repo.base }),
      400,
      'validation_failed',
    );
    await failsWith(
      kit.projects.create(kit.db, kit.actor, { name: 'x', repoPath: join(repo.base, 'missing') }),
      400,
    );
    await failsWith(
      kit.projects.create(kit.db, kit.actor, { name: 'x', repoPath: join(repo.dir, '.git') }),
      400,
    );
    const p = await project();
    expect(p).toMatchObject({ defaultBranch: 'main', slug: 'repo', repoPath: repo.dir });
    expect(existsSync(worktrees)).toBe(true);
    expect((await project({ worktreesRoot: join(repo.base, 'wt2') })).slug).toBe('repo-2');
    expect(kit.deps.audit.entries.map((e) => e.action)).toContain('project.create');
  });

  it('plans a worktree and branch for a project task without creating the folder yet', async () => {
    const p = await project();
    const t = await projectTask(p.id);
    expect(t).toMatchObject({
      projectId: p.id,
      branch: `ab/${t.key}`,
      baseBranch: 'main',
      workDir: join(worktrees, t.key),
    });
    expect(existsSync(t.workDir)).toBe(false);
    const explicit = await kit.task({ projectId: p.id, workDir: '/work/elsewhere' });
    expect(explicit).toMatchObject({ workDir: '/work/elsewhere', branch: null, baseBranch: null });
    await failsWith(kit.task({ projectId: '00000000-0000-4000-8000-000000000000', workDir: undefined }), 400);
  });

  it('runs tasks in parallel on separate branches, commits as the agent and records the checks', async () => {
    const p = await project();
    const acc = await kit.account('a');
    const agent = await kit.agent('alpha', acc.id, { gitIdentity: identity });
    writes({ 'feature.txt': 'one\ntwo\n' });
    const t1 = await projectTask(p.id, { target: { agentId: agent.id } });
    const t2 = await projectTask(p.id, { target: { agentId: agent.id }, title: 'Other' });
    await startWorker();
    const [a, b] = await Promise.all([settled(t1.id), settled(t2.id)]);
    expect(a.workDir).not.toBe(b.workDir);
    expect(branches()).toEqual(expect.arrayContaining(['main', `ab/${a.key}`, `ab/${b.key}`]));
    expect(a.review).toMatchObject({
      status: 'pending',
      diffStat: { files: 1, additions: 2, deletions: 0 },
      commits: [{ subject: `${a.key}: Add feature` }],
    });
    expect(a.review?.checks.map((c) => [c.command, c.exitCode])).toEqual([
      ['echo ok', 0],
      ['echo broken >&2; exit 3', 3],
    ]);
    expect(a.review?.checks[1]?.output).toContain('broken');
    expect(gitOut(a.workDir, 'log', '-1', '--format=%an <%ae>|%cn')).toBe(
      'Alpha Bot <alpha@example.com>|Alpha Bot',
    );
    expect(a.review?.headSha).toBe(gitOut(a.workDir, 'rev-parse', 'HEAD'));
    expect(a.review?.baseSha).toBe(gitOut(repo.dir, 'rev-parse', 'main'));
    expect(gitOut(repo.dir, 'rev-list', '--count', 'main')).toBe('1');
    expect(existsSync(join(repo.dir, 'feature.txt'))).toBe(false);
    const stderr = (await kit.runs.listRuns(kit.db, kit.actor, { taskId: a.id }))[0];
    const events = await kit.runs.listRunEvents(kit.db, kit.actor, stderr?.id ?? '');
    expect(JSON.stringify(events)).toContain('[check] echo ok exited 0');
  });

  it('approve merges with --no-ff into main and removes the worktree and branch', async () => {
    const p = await project();
    writes({ 'feature.txt': 'x\n' });
    const t = await projectTask(p.id, { target: { label: 'x' } });
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    await startWorker();
    const done = await settled(t.id);
    const diff = await kit.review.diff(kit.db, kit.actor, t.id);
    expect(diff.files).toEqual([{ path: 'feature.txt', additions: 1, deletions: 0 }]);
    expect(diff.diff).toContain('+x');
    expect(diff.truncated).toBe(false);
    const merged = await kit.review.approve(kit.db, kit.actor, t.id);
    expect(merged.review?.status).toBe('merged');
    expect(readFileSync(join(repo.dir, 'feature.txt'), 'utf8')).toBe('x\n');
    expect(gitOut(repo.dir, 'log', '--merges', '--format=%s')).toBe(`Merge ${done.key}: Add feature`);
    expect(existsSync(done.workDir)).toBe(false);
    expect(branches()).toEqual(['main']);
    expect(kit.deps.audit.entries.map((e) => e.action)).toContain('review.approve');
    await failsWith(kit.review.approve(kit.db, kit.actor, t.id), 409, 'review_not_open');
    expect((await kit.review.diff(kit.db, kit.actor, t.id)).review.status).toBe('merged');
  });

  it('keeps the worktree after a merge when the project asks for it', async () => {
    const p = await project({ keepWorktrees: true });
    writes({ 'a.txt': 'a\n' });
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    const t = await projectTask(p.id, { target: { label: 'x' } });
    await startWorker();
    await settled(t.id);
    await kit.review.approve(kit.db, kit.actor, t.id);
    expect(existsSync(t.workDir)).toBe(true);
    expect(branches()).toContain(`ab/${t.key}`);
  });

  it('detects a merge conflict, keeps the branch and leaves the repository clean', async () => {
    const p = await project();
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    let n = 0;
    kit.script = (s) => {
      writeFileSync(join(s.workDir, 'shared.txt'), `version ${++n}\n`);
      return { events: [{ kind: 'text', text: 'done' }] };
    };
    const t1 = await projectTask(p.id, { target: { label: 'x' } });
    await startWorker();
    await settled(t1.id);
    const t2 = await projectTask(p.id, { target: { label: 'x' } });
    await settled(t2.id);
    await kit.review.approve(kit.db, kit.actor, t1.id);
    const result = await kit.review.approve(kit.db, kit.actor, t2.id);
    expect(result.review).toMatchObject({ status: 'conflict', conflictFiles: ['shared.txt'] });
    expect(branches()).toContain(`ab/${t2.key}`);
    expect(existsSync(t2.workDir)).toBe(true);
    expect(gitOut(repo.dir, 'status', '--porcelain')).toBe('');
    expect(gitOut(repo.dir, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(readFileSync(join(repo.dir, 'shared.txt'), 'utf8')).toBe('version 1\n');
    expect((await kit.review.diff(kit.db, kit.actor, t2.id)).files.map((f) => f.path)).toEqual([
      'shared.txt',
    ]);
  });

  it('refuses to merge into a dirty or switched main repository', async () => {
    const p = await project();
    writes({ 'f.txt': 'f\n' });
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    const t = await projectTask(p.id, { target: { label: 'x' } });
    await startWorker();
    await settled(t.id);
    writeFileSync(join(repo.dir, 'scratch.txt'), 'wip');
    await failsWith(kit.review.approve(kit.db, kit.actor, t.id), 409, 'base_dirty');
    gitOut(repo.dir, 'checkout', '-q', '-b', 'other');
    await failsWith(kit.review.approve(kit.db, kit.actor, t.id), 409, 'base_not_checked_out');
    expect((await reload(t.id)).review?.status).toBe('pending');
  });

  it('reject requeues the task in the same worktree with the feedback and counts an attempt', async () => {
    const p = await project();
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    const prompts: string[] = [];
    let n = 0;
    kit.script = (s) => {
      prompts.push(s.prompt);
      writeFileSync(join(s.workDir, `f${++n}.txt`), 'x\n');
      return { events: [{ kind: 'text', text: 'done' }] };
    };
    const t = await projectTask(p.id, { target: { label: 'x' }, prompt: 'Build it' });
    await startWorker();
    const first = await settled(t.id);
    const requeued = await kit.review.reject(kit.db, kit.actor, t.id, 'Add tests');
    expect(requeued).toMatchObject({
      status: 'queued',
      attempt: 2,
      review: { status: 'rejected', feedback: 'Add tests' },
    });
    const second = await settled(t.id, 2);
    expect(second.workDir).toBe(first.workDir);
    expect(prompts[1]).toContain('Build it');
    expect(prompts[1]).toContain('Add tests');
    expect(second.review?.status).toBe('pending');
    expect(second.review?.commits).toHaveLength(2);
  });

  it('asks a reviewer agent that works read-only in the same worktree', async () => {
    const p = await project();
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    writes({ 'f.txt': 'f\n' });
    const t = await projectTask(p.id, { target: { label: 'x' } });
    await startWorker();
    await settled(t.id);
    kit.script = () => ({ events: [{ kind: 'text', text: 'Looks fine, ready to merge' }] });
    const reviewer = await kit.review.requestReview(kit.db, kit.actor, t.id, {});
    expect(reviewer).toMatchObject({
      kind: 'review',
      mode: 'read-only',
      parentTaskId: t.id,
      rootTaskId: null,
      workDir: t.workDir,
      projectId: null,
    });
    await waitFor(async () => (await reload(reviewer.id)).status === 'done', 15_000);
    const diff = await kit.review.diff(kit.db, kit.actor, t.id);
    expect(diff.reviewer).toEqual({
      taskId: reviewer.id,
      status: 'done',
      summary: 'Looks fine, ready to merge',
    });
    expect(gitOut(t.workDir, 'status', '--porcelain')).toBe('');
  });

  it('needs agent.manage to merge', async () => {
    const p = await project();
    const acc = await kit.account('a');
    await kit.agent('alpha', acc.id, { labels: ['x'] });
    writes({ 'f.txt': 'f\n' });
    const t = await projectTask(p.id, { target: { label: 'x' } });
    await startWorker();
    await settled(t.id);
    kit.deps.authorizer.deny = (action) => action === 'agent.manage';
    await failsWith(kit.review.approve(kit.db, kit.actor, t.id), 403);
    kit.deps.authorizer.deny = null;
    expect((await reload(t.id)).review?.status).toBe('pending');
    expect(gitOut(repo.dir, 'rev-list', '--count', 'main')).toBe('1');
  });

  it('rejects a review request for a task without changes', async () => {
    const plain = await kit.task({});
    await failsWith(kit.review.diff(kit.db, kit.actor, plain.id), 409, 'no_review');
  });

  it('cleans up the worktree and branch of a cancelled task unless the project keeps them', async () => {
    const p = await project();
    const t = await projectTask(p.id);
    await kit.projectRuns.prepare(kit.db, t);
    expect(existsSync(t.workDir)).toBe(true);
    expect(branches()).toContain(`ab/${t.key}`);
    await kit.projectRuns.prepare(kit.db, t);
    await kit.projectRuns.cleanup(kit.db, t);
    expect(existsSync(t.workDir)).toBe(false);
    expect(branches()).toEqual(['main']);
    await kit.projects.update(kit.db, kit.actor, p.id, { keepWorktrees: true });
    await kit.projectRuns.prepare(kit.db, t);
    await kit.projectRuns.cleanup(kit.db, t);
    expect(existsSync(t.workDir)).toBe(true);
  });

  it('merges subtasks into the goal branch and the goal branch into main at the end', async () => {
    const p = await project();
    const goal = await kit.tasks.createTask(kit.db, kit.actor, {
      title: 'Big goal',
      prompt: 'Plan it',
      target: { label: 'x' },
      kind: 'goal',
      projectId: p.id,
    });
    expect(goal).toMatchObject({ branch: `ab/${goal.key}`, baseBranch: 'main' });
    await kit.projectRuns.prepare(kit.db, goal);
    const child = await kit.db.transaction((tx) =>
      kit.tasks.createChildTask(
        tx,
        kit.actor,
        { title: 'Sub', prompt: 'Do part', workDir: goal.workDir, target: { label: 'x' } },
        {
          kind: 'task',
          rootTaskId: goal.id,
          parentTaskId: goal.id,
          depth: 1,
          dependsOn: [],
          projectId: p.id,
        },
      ),
    );
    expect(child).toMatchObject({
      baseBranch: goal.branch,
      branch: `ab/${child.key}`,
      workDir: join(worktrees, child.key),
    });
    await kit.projectRuns.prepare(kit.db, child);
    writeFileSync(join(child.workDir, 'part.txt'), 'part\n');
    const childReview = await kit.projectRuns.finalize(kit.db, child, identity);
    expect(childReview.commits).toHaveLength(1);
    await markDone(child, childReview);
    await markDone(goal, await kit.projectRuns.finalize(kit.db, goal, identity));
    await failsWith(kit.review.approve(kit.db, kit.actor, goal.id), 409, 'subtasks_unmerged');

    await kit.review.approve(kit.db, kit.actor, child.id);
    expect(gitOut(goal.workDir, 'log', '--merges', '--format=%s')).toBe(`Merge ${child.key}: Sub`);
    expect(existsSync(join(goal.workDir, 'part.txt'))).toBe(true);
    expect(existsSync(join(repo.dir, 'part.txt'))).toBe(false);
    expect(gitOut(repo.dir, 'rev-list', '--count', 'main')).toBe('1');

    const goalReview = await kit.projectRuns.finalize(kit.db, goal, identity);
    expect(goalReview.commits.map((c) => c.subject)).toContain(`${child.key}: Sub`);
    await kit.db.transaction((tx) => kit.tasks.setReview(tx, kit.actor, goal.id, goalReview));
    const merged = await kit.review.approve(kit.db, kit.actor, goal.id);
    expect(merged.review?.status).toBe('merged');
    expect(readFileSync(join(repo.dir, 'part.txt'), 'utf8')).toBe('part\n');
    expect(branches()).toEqual(['main']);
  });
});
