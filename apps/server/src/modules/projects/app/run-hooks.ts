import type { Db } from '../../../platform/db.ts';
import type { Task, TaskReview } from '../../tasks/index.ts';
import { CHECK_TIMEOUT_MS } from '../domain/project.ts';
import {
  commitAll,
  ensureWorktree,
  removeWorktree,
  runCheck,
  type CheckResult,
  type GitIdentity,
} from '../infra/git.ts';
import { branchRange } from './branch.ts';
import type { Projects } from './projects.ts';

export interface ProjectRunsDeps {
  projects: Pick<Projects, 'row'>;
  checkTimeoutMs?: number;
}

/** Git work the worker does around an agent run in a project. */
export function createProjectRuns(deps: ProjectRunsDeps) {
  async function projectOf(db: Db, task: Task) {
    if (!task.projectId) throw new Error(`task ${task.key} has no project`);
    const project = await deps.projects.row(db, task.orgId, task.projectId);
    if (!project) throw new Error(`project of ${task.key} no longer exists`);
    return project;
  }

  return {
    /** Creates the task worktree on its branch before the first run; later runs reuse it. */
    async prepare(db: Db, task: Task): Promise<void> {
      if (!task.projectId || !task.branch) return;
      const project = await projectOf(db, task);
      await ensureWorktree({
        repo: project.repoPath,
        path: task.workDir,
        branch: task.branch,
        base: task.baseBranch ?? project.defaultBranch,
      });
    },
    /**
     * Commits the agent's changes as the agent, runs the project checks in the worktree and describes the
     * branch for review. Checks run after the commit so they see exactly what would be merged.
     */
    async finalize(
      db: Db,
      task: Task,
      identity: GitIdentity,
      onCheck?: (result: CheckResult) => Promise<void> | void,
    ): Promise<TaskReview> {
      const project = await projectOf(db, task);
      await commitAll(task.workDir, `${task.key}: ${task.title}`, identity);
      const checks: TaskReview['checks'] = [];
      for (const command of project.checks) {
        const result = await runCheck(task.workDir, command, deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS);
        await onCheck?.(result);
        checks.push({
          command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          output: result.output,
        });
      }
      const range = await branchRange(task.workDir, task.baseBranch ?? project.defaultBranch, 'HEAD');
      return {
        status: 'pending',
        checks,
        diffStat: range.diffStat,
        commits: range.commits,
        baseSha: range.baseSha,
        headSha: range.headSha,
      };
    },
    /** Removes the worktree and branch of a merged or cancelled task unless the project keeps them. */
    async cleanup(db: Db, task: Task): Promise<void> {
      if (!task.projectId || !task.branch) return;
      const project = await deps.projects.row(db, task.orgId, task.projectId);
      if (!project || project.keepWorktrees) return;
      await removeWorktree(project.repoPath, task.workDir, task.branch);
    },
  };
}

export type ProjectRuns = ReturnType<typeof createProjectRuns>;
