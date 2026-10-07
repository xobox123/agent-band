import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

const AbsolutePath = z
  .string()
  .max(4096)
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'must be an absolute path');
const Checks = z.array(z.string().trim().min(1).max(1000)).max(20);

export const ProjectDto = z.object({
  id: Id,
  orgId: Id,
  name: z.string(),
  slug: z.string(),
  /** Absolute path of the git repository. */
  repoPath: z.string(),
  defaultBranch: z.string(),
  /** Folder under which every task gets its own git worktree. */
  worktreesRoot: z.string(),
  /** Shell commands run in the worktree after an agent finishes. */
  checks: z.array(z.string()),
  /** Keep the worktree and branch after a merge or cancel. */
  keepWorktrees: z.boolean(),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ProjectDto = z.infer<typeof ProjectDto>;
export const ProjectList = listOf(ProjectDto);

export const CreateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** Omit to derive it from the name. */
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes')
      .optional(),
    repoPath: AbsolutePath,
    /** Omit to use `<workspaceRoot>/<slug>/worktrees`. */
    worktreesRoot: AbsolutePath.optional(),
    checks: Checks.optional(),
    keepWorktrees: z.boolean().optional(),
  })
  .strict();
export type CreateProjectBody = z.input<typeof CreateProjectBody>;

export const UpdateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    checks: Checks,
    keepWorktrees: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');
export type UpdateProjectBody = z.input<typeof UpdateProjectBody>;

export const ValidateRepoQuery = z.object({ path: AbsolutePath });
export const ValidateRepoDto = z.object({
  valid: z.boolean(),
  defaultBranch: z.string().nullable(),
  reason: z.string().nullable(),
});
export type ValidateRepoDto = z.infer<typeof ValidateRepoDto>;

/** Adds the project's worktrees folder to a policy's allowed directories. */
export const AllowProjectBody = z.object({ policyId: Id }).strict();

export const ReviewStatus = z.enum(['pending', 'approved', 'rejected', 'merged', 'conflict']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const ReviewCheck = z.object({
  command: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  /** Tail of the combined output (at most 16 KB). */
  output: z.string().optional(),
});
export type ReviewCheck = z.infer<typeof ReviewCheck>;

export const FileStat = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type FileStat = z.infer<typeof FileStat>;

export const ReviewDto = z.object({
  status: ReviewStatus,
  checks: z.array(ReviewCheck),
  diffStat: z.object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }),
  commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
  baseSha: z.string(),
  headSha: z.string(),
  /** Reviewer subtask requested through `review/request`. */
  reviewerTaskId: Id.nullable().optional(),
  /** Files that conflicted on the last merge attempt. */
  conflictFiles: z.array(z.string()).optional(),
  /** Feedback of the last rejection. */
  feedback: z.string().nullable().optional(),
  /** Shown when the last merge attempt failed for a reason other than a conflict. */
  mergeError: z.string().nullable().optional(),
});
export type ReviewDto = z.infer<typeof ReviewDto>;

export const TaskDiffDto = z.object({
  /** Unified diff against the base, cut at `maxBytes`. */
  diff: z.string(),
  truncated: z.boolean(),
  files: z.array(FileStat),
  baseSha: z.string(),
  headSha: z.string(),
  review: ReviewDto,
  reviewer: z.object({ taskId: Id, status: z.string(), summary: z.string().nullable() }).nullable(),
});
export type TaskDiffDto = z.infer<typeof TaskDiffDto>;

export const RejectReviewBody = z.object({ feedback: z.string().trim().min(1).max(4000) }).strict();
