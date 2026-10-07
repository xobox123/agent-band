export const reviewStatuses = ['pending', 'approved', 'rejected', 'merged', 'conflict'] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export const reviewerVerdicts = ['APPROVE', 'CHANGES REQUESTED'] as const;
export type ReviewerVerdict = (typeof reviewerVerdicts)[number];

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
  /** Commit the checks ran on. */
  checksSha?: string | null;
  reviewerTaskId?: string | null;
  /** Commit the requested reviewer is looking at. */
  reviewRequestedSha?: string | null;
  reviewerVerdict?: ReviewerVerdict | null;
  reviewerFindings?: string[];
  /** Commit the reviewer verdict applies to. */
  reviewedSha?: string | null;
  /** Automatic requeues after CHANGES REQUESTED; carried over to the next review of the task. */
  reviewLoops?: number;
  conflictFiles?: string[];
  feedback?: string | null;
  mergeError?: string | null;
}

/** Review states in which the branch still waits for a decision. */
export const openReviewStatuses: readonly ReviewStatus[] = ['pending', 'conflict', 'rejected'];
