export const reviewStatuses = ['pending', 'approved', 'rejected', 'merged', 'conflict'] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export interface ReviewCheck {
  command: string;
  exitCode: number;
  durationMs: number;
  output?: string;
}

/** Outcome of a finished project task, kept on the task until the branch is merged or discarded. */
export interface TaskReview {
  status: ReviewStatus;
  checks: ReviewCheck[];
  diffStat: { files: number; additions: number; deletions: number };
  commits: { sha: string; subject: string }[];
  baseSha: string;
  headSha: string;
  reviewerTaskId?: string | null;
  conflictFiles?: string[];
  feedback?: string | null;
  mergeError?: string | null;
}

/** Review states in which the branch still waits for a decision. */
export const openReviewStatuses: readonly ReviewStatus[] = ['pending', 'conflict', 'rejected'];
