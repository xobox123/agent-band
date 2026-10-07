import { expect, it } from 'vitest';
import type { TaskReview } from '../../tasks/index.ts';
import { evaluateGate } from './gate.ts';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const review = (extra: Partial<TaskReview> = {}): TaskReview => ({
  status: 'pending',
  checks: [{ command: 'npm test', exitCode: 0, durationMs: 1 }],
  diffStat: { files: 1, additions: 1, deletions: 0 },
  commits: [],
  baseSha: 'c'.repeat(40),
  headSha: SHA,
  checksSha: SHA,
  reviewerVerdict: 'APPROVE',
  reviewedSha: SHA,
  ...extra,
});
const codes = (r: TaskReview, live: string | null = SHA) => evaluateGate(r, live).blockers.map((b) => b.code);

it('opens when checks passed, the reviewer approved and the branch did not move', () => {
  expect(evaluateGate(review(), SHA)).toMatchObject({
    canMerge: true,
    checks: 'passed',
    verdict: 'approved',
  });
  expect(codes(review())).toEqual([]);
});

it('closes on failed checks and does not allow an override', () => {
  const gate = evaluateGate(review({ checks: [{ command: 'x', exitCode: 1, durationMs: 1 }] }), SHA);
  expect(gate.blockers.map((b) => b.code)).toEqual(['checks_not_passed']);
  expect(gate).toMatchObject({ canMerge: false, overridable: false, checks: 'failed' });
});

it('closes when the checks ran on another commit', () => {
  expect(codes(review({ checksSha: OTHER }))).toEqual(['checks_stale']);
  expect(codes(review({ checksSha: null }))).toEqual(['checks_stale']);
});

it('closes without a verdict, on changes requested and on a verdict for another commit', () => {
  expect(codes(review({ reviewerVerdict: null, reviewedSha: null }))).toEqual(['reviewer_missing']);
  expect(codes(review({ reviewerVerdict: 'CHANGES REQUESTED' }))).toEqual(['reviewer_changes_requested']);
  expect(codes(review({ reviewedSha: OTHER }))).toEqual(['reviewer_stale']);
  expect(evaluateGate(review({ reviewedSha: OTHER }), SHA).overridable).toBe(true);
});

it('closes when the branch moved and then nothing may be overridden', () => {
  const gate = evaluateGate(review({ reviewerVerdict: null }), OTHER);
  expect(gate.blockers.map((b) => b.code)).toEqual(['branch_moved', 'reviewer_missing']);
  expect(gate.overridable).toBe(false);
  expect(codes(review(), null)).toEqual(['branch_moved']);
});
