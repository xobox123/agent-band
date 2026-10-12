import { z } from 'zod';
import { Id, IsoDate, listOf } from './common.ts';

const AbsolutePath = z
  .string()
  .max(4096)
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'must be an absolute path');
export const ReviewerTarget = z.union([
  z.object({ agentId: Id }).strict(),
  z.object({ label: z.string().trim().min(1).max(100) }).strict(),
]);
export type ReviewerTarget = z.infer<typeof ReviewerTarget>;
const Checks = z.array(z.string().trim().min(1).max(1000)).max(20);
export const DocsOnlyChecks = z
  .object({
    paths: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(100)
      .default(['**/*.md', 'docs/**', 'handoff/**']),
    checks: Checks.min(1).default(['npx prettier --check <changed files>']),
  })
  .strict();
export type DocsOnlyChecks = z.infer<typeof DocsOnlyChecks>;

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
  /** Null disables reduced checks; an object enables them for documentation-only diffs. */
  docsOnlyChecks: DocsOnlyChecks.nullable(),
  /** Keep the worktree and branch after a merge or cancel. */
  keepWorktrees: z.boolean(),
  /** Agent or label that reviews a finished task automatically; null for no automatic review. */
  reviewerTarget: ReviewerTarget.nullable(),
  /** Merge without asking when the reviewer approves and the checks passed. */
  autoMergeOnApprove: z.boolean(),
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
    docsOnlyChecks: DocsOnlyChecks.nullable().optional(),
    keepWorktrees: z.boolean().optional(),
    reviewerTarget: ReviewerTarget.nullable().optional(),
    autoMergeOnApprove: z.boolean().optional(),
  })
  .strict();
export type CreateProjectBody = z.input<typeof CreateProjectBody>;

export const UpdateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    checks: Checks,
    docsOnlyChecks: DocsOnlyChecks.nullable(),
    keepWorktrees: z.boolean(),
    reviewerTarget: ReviewerTarget.nullable(),
    autoMergeOnApprove: z.boolean(),
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

export const ReviewerVerdict = z.enum(['APPROVE', 'CHANGES REQUESTED']);
export type ReviewerVerdict = z.infer<typeof ReviewerVerdict>;

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
  checkSet: z.enum(['full', 'docs']).optional(),
  checkReason: z.string().optional(),
  diffStat: z.object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }),
  commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
  baseSha: z.string(),
  headSha: z.string(),
  /** Commit the checks ran on. */
  checksSha: z.string().nullable().optional(),
  /** Reviewer subtask requested through `review/request` or started by the project's reviewer setting. */
  reviewerTaskId: Id.nullable().optional(),
  /** Latest reviewer verdict, parsed from the reviewer's reply. */
  reviewerVerdict: ReviewerVerdict.nullable().optional(),
  reviewerFindings: z.array(z.string()).optional(),
  /** Commit the reviewer verdict applies to. */
  reviewedSha: z.string().nullable().optional(),
  /** Automatic requeues after CHANGES REQUESTED so far. */
  reviewLoops: z.number().int().nonnegative().optional(),
  /** Files that conflicted on the last merge attempt. */
  conflictFiles: z.array(z.string()).optional(),
  /** Feedback of the last rejection. */
  feedback: z.string().nullable().optional(),
  /** Shown when the last merge attempt failed for a reason other than a conflict. */
  mergeError: z.string().nullable().optional(),
});
export type ReviewDto = z.infer<typeof ReviewDto>;

export const GateCode = z.enum([
  'branch_moved',
  'checks_not_passed',
  'checks_stale',
  'reviewer_missing',
  'reviewer_changes_requested',
  'reviewer_stale',
]);

/** Merge gate: checks and reviewer verdict must apply to the commit that is merged. */
export const GateDto = z.object({
  sha: z.string(),
  liveSha: z.string().nullable(),
  checks: z.enum(['passed', 'failed', 'stale']),
  verdict: z.enum(['approved', 'changes_requested', 'stale', 'missing']),
  blockers: z.array(z.object({ code: GateCode, message: z.string() })),
  /** Only the reviewer verdict blocks, so an owner may override it with a reason. */
  overridable: z.boolean(),
  canMerge: z.boolean(),
});
export type GateDto = z.infer<typeof GateDto>;

export const TaskDiffDto = z.object({
  /** Unified diff against the base, cut at `maxBytes`. */
  diff: z.string(),
  truncated: z.boolean(),
  files: z.array(FileStat),
  baseSha: z.string(),
  headSha: z.string(),
  review: ReviewDto,
  reviewer: z.object({ taskId: Id, status: z.string(), summary: z.string().nullable() }).nullable(),
  /** Null once merged. */
  gate: GateDto.nullable(),
});
export type TaskDiffDto = z.infer<typeof TaskDiffDto>;

export const ApproveReviewBody = z
  .object({
    /** Merge although the reviewer has not approved this commit; audited. */
    overrideReason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type ApproveReviewBody = z.input<typeof ApproveReviewBody>;

export const RejectReviewBody = z.object({ feedback: z.string().trim().min(1).max(4000) }).strict();
