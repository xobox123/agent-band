import type { TaskReview } from '../../tasks/index.ts';

export type GateCode =
  | 'branch_moved'
  | 'checks_not_passed'
  | 'checks_stale'
  | 'reviewer_missing'
  | 'reviewer_changes_requested'
  | 'reviewer_stale';

export interface GateBlocker {
  code: GateCode;
  message: string;
}

export interface Gate {
  /** Commit the checks and the verdict are bound to; this exact commit is merged. */
  sha: string;
  /** Current head of the task branch, when it could be read. */
  liveSha: string | null;
  checks: 'passed' | 'failed' | 'stale';
  verdict: 'approved' | 'changes_requested' | 'stale' | 'missing';
  blockers: GateBlocker[];
  /** Only the reviewer verdict blocks, so an owner may override it with a reason. */
  overridable: boolean;
  canMerge: boolean;
}

const short = (sha: string | null | undefined) => (sha ?? 'none').slice(0, 7);

/**
 * Merge gate: checks passed on the recorded head, the latest reviewer verdict approves that same head, and the
 * branch still points at it. Any new commit changes the live head and so invalidates both.
 */
export function evaluateGate(review: TaskReview, liveSha: string | null): Gate {
  const sha = review.headSha;
  const blockers: GateBlocker[] = [];
  if (liveSha !== sha)
    blockers.push({
      code: 'branch_moved',
      message: `The branch is at ${short(liveSha)} but the review covers ${short(sha)}; the checks and the verdict no longer apply`,
    });

  const checks: Gate['checks'] =
    review.checksSha !== sha ? 'stale' : review.checks.every((c) => c.exitCode === 0) ? 'passed' : 'failed';
  if (checks === 'stale')
    blockers.push({
      code: 'checks_stale',
      message: `The checks ran on ${short(review.checksSha)}, not on ${short(sha)}`,
    });
  if (checks === 'failed')
    blockers.push({ code: 'checks_not_passed', message: `The checks failed on ${short(sha)}` });

  const verdictBlockers: GateBlocker[] = [];
  let verdict: Gate['verdict'];
  if (!review.reviewerVerdict) {
    verdict = 'missing';
    verdictBlockers.push({ code: 'reviewer_missing', message: 'No reviewer verdict yet' });
  } else if (review.reviewedSha !== sha) {
    verdict = 'stale';
    verdictBlockers.push({
      code: 'reviewer_stale',
      message: `The reviewer looked at ${short(review.reviewedSha)}, not at ${short(sha)}`,
    });
  } else if (review.reviewerVerdict !== 'APPROVE') {
    verdict = 'changes_requested';
    verdictBlockers.push({ code: 'reviewer_changes_requested', message: 'The reviewer requested changes' });
  } else {
    verdict = 'approved';
  }
  blockers.push(...verdictBlockers);

  return {
    sha,
    liveSha,
    checks,
    verdict,
    blockers,
    overridable: verdictBlockers.length > 0 && blockers.length === verdictBlockers.length,
    canMerge: blockers.length === 0,
  };
}
