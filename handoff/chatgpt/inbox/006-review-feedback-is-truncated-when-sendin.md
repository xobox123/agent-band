# 006: Review feedback is truncated when sending changes back

Board task: AB-64. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
POST /tasks/:id/review/reject rejects long feedback (validation) and callers truncate it, so authors lose findings (seen in production with AB-55 losing finding 7). Raise the feedback limit (e.g. 50k), or better: store the full reviewer report on the task review record and reference it from the requeued prompt instead of copying text; show the full findings in the Changes tab. Tests. Rules: read AGENTS.md; own worktree; no git commit/push; short report.

Reviewer feedback (attempt 2). Fix the issues below in the same worktree:
Project checks failed. Fix these errors (if they look environmental or flaky, say so):

npm run format:check:


npx vitest run --root apps/server --maxWorkers=2:
     ✓ maps AppError with code and status  1037ms
 FAIL   server  src/roles/worker.test.ts > worker eligibility > does not churn claims or audit rows for a task with no eligible agent, and picks it up once one exists
AssertionError: expected [ Array(2) ] to have a length of 1 but got 2

## Deliverables
Code and tests on branch `chatgpt/006-review-feedback-is-truncated-when-sendin`, report
`handoff/chatgpt/reports/006-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.
