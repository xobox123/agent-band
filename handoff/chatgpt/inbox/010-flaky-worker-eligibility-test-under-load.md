# 010: Flaky worker eligibility test under load

Board task: AB-118. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
apps/server/src/roles/worker.test.ts "does not churn claims or audit rows for a task with no eligible agent" fails intermittently in project checks under parallel load (expected length 1, got 2) but passes alone. Find the race (timing or ordering of claim/audit rows) and make the test deterministic without weakening it. Run the server suite several times with --maxWorkers=2.

## Deliverables
Code and tests on branch `chatgpt/010-flaky-worker-eligibility-test-under-load`, report
`handoff/chatgpt/reports/010-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.
