import { existsSync } from 'node:fs';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, notFound } from '../../../platform/errors.ts';
import type { ModuleDeps } from '../../../ports/index.ts';
import {
  openReviewStatuses,
  taskResource,
  type Task,
  type TaskReview,
  type TaskTarget,
  type createTasks,
} from '../../tasks/index.ts';
import { DIFF_MAX_BYTES, feedbackPrompt, type FileStat } from '../domain/project.ts';
import { currentBranch, diffFiles, isClean, mergeNoFf, unifiedDiff } from '../infra/git.ts';
import type { Project } from '../infra/schema.ts';
import { branchRange } from './branch.ts';
import type { ProjectRuns } from './run-hooks.ts';
import type { Projects } from './projects.ts';

export interface ReviewDeps extends ModuleDeps {
  tasks: ReturnType<typeof createTasks>;
  projects: Pick<Projects, 'row'>;
  runs: Pick<ProjectRuns, 'cleanup'>;
}

export interface TaskDiff {
  diff: string;
  truncated: boolean;
  files: FileStat[];
  baseSha: string;
  headSha: string;
  review: TaskReview;
  reviewer: { taskId: string; status: string; summary: string | null } | null;
}

const MERGE_IDENTITY = { name: 'agent-band', email: 'agent-band@localhost' };

export function createReview(deps: ReviewDeps) {
  // Merges into one repository must not overlap.
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  }

  async function load(db: Db, actor: ActorContext, id: string) {
    const task = await deps.tasks.getTask(db, actor, id);
    if (!task.projectId || !task.branch || !task.review)
      throw conflict('no_review', `${task.key} has no changes to review`);
    const project = await deps.projects.row(db, actor.orgId, task.projectId);
    if (!project) throw notFound('project');
    return { task, project, review: task.review };
  }

  /** Directory in which the task branch is merged: the repository itself or the goal worktree. */
  async function mergeDirOf(db: Db, actor: ActorContext, task: Task, project: Project): Promise<string> {
    const base = task.baseBranch ?? project.defaultBranch;
    let dir = project.repoPath;
    if (base !== project.defaultBranch) {
      const goal = task.rootTaskId
        ? (await deps.tasks.listTree(db, actor.orgId, task.rootTaskId)).find((t) => t.branch === base)
        : undefined;
      if (!goal || !existsSync(`${goal.workDir}/.git`))
        throw conflict('base_missing', `The worktree of branch ${base} no longer exists`);
      dir = goal.workDir;
    }
    const current = await currentBranch(dir);
    if (current !== base)
      throw conflict(
        'base_not_checked_out',
        `${dir} is on ${current ?? 'a detached HEAD'}, check out ${base} first`,
      );
    if (!(await isClean(dir)))
      throw conflict('base_dirty', `${dir} has uncommitted changes; commit or stash them before merging`);
    return dir;
  }

  return {
    async diff(db: Db, actor: ActorContext, id: string): Promise<TaskDiff> {
      const { task, project, review } = await load(db, actor, id);
      const base = task.baseBranch ?? project.defaultBranch;
      // A merged branch no longer differs from its base, so its stored range is the truth.
      const live =
        review.status === 'merged'
          ? undefined
          : await branchRange(project.repoPath, base, task.branch ?? '').catch(() => undefined);
      const baseSha = live?.baseSha ?? review.baseSha;
      const headSha = live?.headSha ?? review.headSha;
      const { diff, truncated } = await unifiedDiff(project.repoPath, baseSha, headSha, DIFF_MAX_BYTES);
      const files = live?.files ?? (await diffFiles(project.repoPath, baseSha, headSha));
      let reviewer: TaskDiff['reviewer'] = null;
      if (review.reviewerTaskId) {
        const r = await deps.tasks.getTask(db, actor, review.reviewerTaskId).catch(() => undefined);
        if (r) reviewer = { taskId: r.id, status: r.status, summary: r.result?.summary ?? null };
      }
      return { diff, truncated, files, baseSha, headSha, review, reviewer };
    },

    /** Merges the task branch into its base with `--no-ff`; a conflict keeps the branch for another try. */
    async approve(db: Db, actor: ActorContext, id: string): Promise<Task> {
      const first = await deps.tasks.getTask(db, actor, id);
      await deps.authorizer.authorize(db, actor, 'agent.manage', taskResource(first.target));
      return serial(first.projectId ?? id, async () => {
        const { task, project, review } = await load(db, actor, id);
        if (task.status !== 'done' || !['pending', 'conflict'].includes(review.status))
          throw conflict('review_not_open', `${task.key} is not waiting for a decision`);
        if (task.kind === 'goal') {
          const open = (await deps.tasks.listTree(db, actor.orgId, task.id)).filter(
            (t) => t.id !== task.id && t.review && openReviewStatuses.includes(t.review.status),
          );
          if (open.length > 0)
            throw conflict(
              'subtasks_unmerged',
              `Merge or discard ${open.map((t) => t.key).join(', ')} first`,
            );
        }
        const dir = await mergeDirOf(db, actor, task, project);
        const base = task.baseBranch ?? project.defaultBranch;
        const range = await branchRange(project.repoPath, base, task.branch ?? '');
        const result = await mergeNoFf({
          cwd: dir,
          branch: task.branch ?? '',
          message: `Merge ${task.key}: ${task.title}`,
          fallbackIdentity: MERGE_IDENTITY,
        });
        const described = {
          diffStat: range.diffStat,
          commits: range.commits,
          baseSha: range.baseSha,
          headSha: range.headSha,
        };
        if (result.ok) {
          const merged = await db.transaction((tx) =>
            deps.tasks.setReview(
              tx,
              actor,
              id,
              { ...review, ...described, status: 'merged', conflictFiles: [], mergeError: null },
              'review.approve',
            ),
          );
          await deps.runs.cleanup(db, merged).catch(() => undefined);
          return merged;
        }
        if (result.conflictFiles.length > 0)
          return db.transaction((tx) =>
            deps.tasks.setReview(
              tx,
              actor,
              id,
              {
                ...review,
                ...described,
                status: 'conflict',
                conflictFiles: result.conflictFiles,
                mergeError: null,
              },
              'review.conflict',
            ),
          );
        await db.transaction((tx) =>
          deps.tasks.setReview(
            tx,
            actor,
            id,
            { ...review, mergeError: result.message },
            'review.merge_failed',
          ),
        );
        throw conflict('merge_failed', result.message || 'git merge failed');
      });
    },

    /** Requeues the task in its worktree with the feedback appended to the prompt. */
    async reject(db: Db, actor: ActorContext, id: string, feedback: string): Promise<Task> {
      const { task } = await load(db, actor, id);
      return db.transaction((tx) =>
        deps.tasks.requeueForReview(tx, actor, task.id, {
          feedback,
          prompt: (current, attempt) => feedbackPrompt(current, feedback, attempt),
        }),
      );
    },

    /** Creates a read-only reviewer task in the same worktree and links it to the review. */
    async requestReview(
      db: Db,
      actor: ActorContext,
      id: string,
      input: { target?: TaskTarget | undefined; prompt?: string | undefined },
    ): Promise<Task> {
      const { task, review } = await load(db, actor, id);
      const target = input.target ?? task.target;
      await deps.authorizer.authorize(db, actor, 'task.write', taskResource(target));
      if (!openReviewStatuses.includes(review.status) || review.status === 'rejected')
        throw conflict('review_not_open', `${task.key} is not waiting for a decision`);
      const prompt =
        input.prompt ??
        [
          `Review the changes of ${task.key} (${task.title}) in this worktree.`,
          `They are the commits on branch ${task.branch ?? ''} that are not in ${task.baseBranch ?? 'the base branch'}.`,
          'Do not modify files. Report problems by file and line, and say whether the change is ready to merge.',
          `Original task:\n${task.prompt}`,
        ].join('\n');
      return db.transaction(async (tx) => {
        const reviewer = await deps.tasks.createReviewTask(tx, actor, task, { target, prompt });
        await deps.tasks.setReview(
          tx,
          actor,
          id,
          { ...review, reviewerTaskId: reviewer.id },
          'review.request',
        );
        return reviewer;
      });
    },
  };
}

export type Review = ReturnType<typeof createReview>;
