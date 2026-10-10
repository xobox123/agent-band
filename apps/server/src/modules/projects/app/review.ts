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
import { evaluateGate, type Gate } from '../domain/gate.ts';
import { DIFF_MAX_BYTES, feedbackPrompt, type FileStat } from '../domain/project.ts';
import { findingsFeedback, parseVerdict, reviewerPrompt } from '../domain/verdict.ts';
import { currentBranch, diffFiles, isClean, mergeNoFf, revParse, unifiedDiff } from '../infra/git.ts';
import type { Project } from '../infra/schema.ts';
import { branchRange } from './branch.ts';
import type { ProjectRuns } from './run-hooks.ts';
import type { Projects } from './projects.ts';

export interface ReviewDeps extends ModuleDeps {
  tasks: ReturnType<typeof createTasks>;
  projects: Pick<Projects, 'row'>;
  runs: Pick<ProjectRuns, 'cleanup'>;
}

function sameTarget(a: TaskTarget | null | undefined, b: TaskTarget | null | undefined): boolean {
  if (!a || !b) return false;
  if ('agentId' in a && 'agentId' in b) return a.agentId === b.agentId;
  if ('label' in a && 'label' in b) return a.label === b.label;
  return false;
}

export interface TaskDiff {
  diff: string;
  truncated: boolean;
  files: FileStat[];
  baseSha: string;
  headSha: string;
  review: TaskReview;
  reviewer: { taskId: string; status: string; summary: string | null } | null;
  /** Merge gate state while the review is open; null once merged. */
  gate: Gate | null;
}

const MERGE_IDENTITY = { name: 'agent-band', email: 'agent-band@localhost' };

/** Automatic requeues after CHANGES REQUESTED before the human has to step in. */
export const MAX_REVIEW_LOOPS = 2;

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

  /** Merges the reviewed commit of a task branch, after the merge gate allowed it. */
  async function merge(
    db: Db,
    actor: ActorContext,
    id: string,
    overrideReason: string | undefined,
  ): Promise<Task> {
    const first = await deps.tasks.getTask(db, actor, id);
    return serial(first.projectId ?? id, async () => {
      const { task, project, review } = await load(db, actor, id);
      if (task.status !== 'done' || !['pending', 'conflict'].includes(review.status))
        throw conflict('review_not_open', `${task.key} is not waiting for a decision`);
      const live = await revParse(project.repoPath, task.branch ?? '').catch(() => null);
      const gate = evaluateGate(review, live);
      const blocker = gate.blockers[0];
      if (blocker) {
        if (!gate.overridable || !overrideReason)
          throw conflict(
            blocker.code,
            gate.overridable ? `${blocker.message}; an owner can override with a reason` : blocker.message,
          );
        await deps.authorizer.authorize(db, actor, 'review.override', {});
        await db.transaction((tx) =>
          deps.audit.append(tx, {
            orgId: actor.orgId,
            actorId: actor.principalId,
            action: 'review.override',
            targetType: 'task',
            targetId: task.id,
            data: { reason: overrideReason, sha: gate.sha, blockers: gate.blockers.map((b) => b.code) },
          }),
        );
      }
      if (task.kind === 'goal') {
        const open = (await deps.tasks.listTree(db, actor.orgId, task.id)).filter(
          (t) => t.id !== task.id && t.review && openReviewStatuses.includes(t.review.status),
        );
        if (open.length > 0)
          throw conflict('subtasks_unmerged', `Merge or discard ${open.map((t) => t.key).join(', ')} first`);
      }
      const dir = await mergeDirOf(db, actor, task, project);
      const base = task.baseBranch ?? project.defaultBranch;
      const range = await branchRange(project.repoPath, base, review.headSha);
      // The commit is merged by SHA so nothing pushed after the review can slip in.
      const result = await mergeNoFf({
        cwd: dir,
        branch: review.headSha,
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
        deps.tasks.setReview(tx, actor, id, { ...review, mergeError: result.message }, 'review.merge_failed'),
      );
      throw conflict('merge_failed', result.message || 'git merge failed');
    });
  }

  /** Creates a read-only reviewer task in the task worktree and binds it to the commit it will look at. */
  async function spawnReviewer(
    db: Db,
    actor: ActorContext,
    task: Task,
    project: Project,
    target: TaskTarget,
  ): Promise<Task> {
    const review = task.review;
    if (!review) throw conflict('no_review', `${task.key} has no changes to review`);
    const live = await revParse(project.repoPath, task.branch ?? '').catch(() => null);
    if (live !== review.headSha)
      throw conflict('branch_moved', `${task.key} has new commits since its checks ran`);
    const prompt = reviewerPrompt({
      key: task.key,
      title: task.title,
      branch: task.branch ?? '',
      base: task.baseBranch ?? project.defaultBranch,
      sha: review.headSha,
      prompt: task.prompt,
    });
    return db.transaction(async (tx) => {
      const reviewer = await deps.tasks.createReviewTask(tx, actor, task, { target, prompt });
      await deps.tasks.setReview(
        tx,
        actor,
        task.id,
        {
          ...review,
          reviewerTaskId: reviewer.id,
          reviewRequestedSha: review.headSha,
          reviewerVerdict: null,
          reviewerFindings: [],
          reviewedSha: null,
        },
        'review.request',
      );
      return reviewer;
    });
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
      const gate = review.status === 'merged' ? null : evaluateGate(review, live?.headSha ?? null);
      return { diff, truncated, files, baseSha, headSha, review, reviewer, gate };
    },

    /**
     * Merges the reviewed commit into the base with `--no-ff`; a conflict keeps the branch for another try.
     * Allowed only when the merge gate passes, or when only the reviewer verdict is missing and an override
     * reason is given.
     */
    async approve(
      db: Db,
      actor: ActorContext,
      id: string,
      input: { overrideReason?: string | undefined } = {},
    ): Promise<Task> {
      const first = await deps.tasks.getTask(db, actor, id);
      await deps.authorizer.authorize(db, actor, 'agent.manage', taskResource(first.target));
      return merge(db, actor, id, input.overrideReason?.trim() || undefined);
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
      input: { target?: TaskTarget | undefined },
    ): Promise<Task> {
      const { task, project, review } = await load(db, actor, id);
      const target = input.target ?? task.target;
      await deps.authorizer.authorize(db, actor, 'task.write', taskResource(target));
      if (!openReviewStatuses.includes(review.status) || review.status === 'rejected')
        throw conflict('review_not_open', `${task.key} is not waiting for a decision`);
      return spawnReviewer(db, actor, task, project, target);
    },

    /** Worker hook for a finished project task: starts the project's reviewer when its checks passed. */
    async onTaskReviewable(db: Db, actor: ActorContext, id: string): Promise<Task | undefined> {
      const { task, project, review } = await load(db, actor, id);
      if (!project.reviewerTarget || task.status !== 'done' || review.status !== 'pending') return undefined;
      if (review.reviewerTaskId || review.checksSha !== review.headSha) return undefined;
      if (review.checks.some((c) => c.exitCode !== 0)) return undefined;
      return spawnReviewer(db, actor, task, project, project.reviewerTarget);
    },

    /**
     * Worker hook for a finished reviewer task: stores the verdict on the reviewed task and applies the
     * project automation (merge on approve, requeue on requested changes).
     */
    async onReviewerFinished(db: Db, actor: ActorContext, reviewerTaskId: string): Promise<void> {
      const reviewer = await deps.tasks.getTask(db, actor, reviewerTaskId);
      if (reviewer.kind !== 'review' || reviewer.status !== 'done' || !reviewer.parentTaskId) return;
      const { task, project, review } = await load(db, actor, reviewer.parentTaskId);
      // A newer review of the task or a newer reviewer request supersedes this reviewer.
      if (task.status !== 'done' || review.status !== 'pending' || review.reviewerTaskId !== reviewer.id)
        return;
      const parsed = parseVerdict(reviewer.result?.summary ?? '');
      if (!parsed || !review.reviewRequestedSha) return;
      await db.transaction((tx) =>
        deps.tasks.setReview(
          tx,
          actor,
          task.id,
          {
            ...review,
            reviewerVerdict: parsed.verdict,
            reviewerFindings: parsed.findings,
            reviewedSha: review.reviewRequestedSha ?? null,
          },
          'review.verdict',
        ),
      );
      if (parsed.verdict === 'APPROVE') {
        // A refused or failed merge stays visible on the review for the human.
        // Only the project's own reviewer may trigger it, not one picked through a manual request.
        if (project.autoMergeOnApprove && sameTarget(reviewer.target, project.reviewerTarget))
          await merge(db, actor, task.id, undefined).catch(() => undefined);
        return;
      }
      const loops = review.reviewLoops ?? 0;
      if (loops >= MAX_REVIEW_LOOPS) return;
      const feedback = findingsFeedback(parsed.findings);
      await db
        .transaction((tx) =>
          deps.tasks.requeueForReview(tx, actor, task.id, {
            feedback,
            review: { reviewLoops: loops + 1 },
            prompt: (current, attempt) => feedbackPrompt(current, feedback, attempt),
          }),
        )
        .catch(() => undefined);
    },
  };
}

export type Review = ReturnType<typeof createReview>;
