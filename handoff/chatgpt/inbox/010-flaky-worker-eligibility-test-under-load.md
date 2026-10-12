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

## Architect note (rework 1, PR #10)

The reviewer approved the code, but the lead ran `npx vitest run --root apps/server src/roles/worker.test.ts` three times on current main with your change merged: the test "does not churn claims or audit rows for a task with no eligible agent" still fails 3/3 with `expected [ Array(2) ] to have a length of 1 but got 2`, exactly as without your change. The race is not fixed. Merge the latest main, find which second audit/claim row appears (log the rows in the assertion message) and fix the cause, not only the ordering in the test.

Reviewer notes for reference:


The PR finds the right race and closes it with an event-ordering barrier rather than a sleep. All the original assertions are kept: exactly one `task.ineligible`, zero claim/release audits, at most two audits, and the task being picked up once an eligible agent exists. It only changes the test and the report, so there are no production, migration, contract, UI or security changes to check.

I could not run the tests myself. This worktree has no `node_modules`, so vitest failed with `ERR_MODULE_NOT_FOUND`, and installing would have changed the folder. The repeated `--maxWorkers=2` runs the task asks for have not been done by anyone yet, the author included. The verdict rests on code reading plus the green CI run.

**Why the fix holds up:**
- **The race is real.** On `main`, the worker subscribes (`apps/server/src/roles/worker.ts:842`) and only then calls `deps.events.start()`. The account and agent setup events were committed before anything was listening. A first listener in Postgres (and PGlite) can still be handed those older notifications, and when they arrive is nondeterministic. A late `agent.created` or `account.created` therefore reaches the `recheck()` path (`worker.ts:852`), which clears eligibility after the first check and produces the second `task.ineligible`.
- **No other source exists.** The worker's own sentinel run publishes only `run.*` and `task.*` events, which don't trigger a recheck, so the setup events are the only trigger.
- **The barrier is sound.** `EventStream` delivers events one at a time, in queue order, through `this.chain` (`apps/server/src/platform/outbox.ts:33`). So once the test sees the sentinel, every earlier notification has been delivered, including any `org.changed` left over from building the test kit. At that point the test's subscriber is removed and the worker's own `events.start()` does nothing because the stream is already running (`outbox.ts:31`). The sentinel has no `orgId`, so the worker's filter would ignore it even if it saw it.
- **The fix doesn't weaken the test.** Rechecks triggered by agent changes are still exercised at the end, when `ghost1` is created after the worker is running.

**Findings:**

| severity | location | issue | fix |
|---|---|---|---|
| minor | `handoff/chatgpt/reports/010-report.md` (Not done) | The `--maxWorkers=2` repeat runs the task asks for were never done. The report says so honestly, but CI runs the suite once and doesn't test under load. | Before merging, run `npx vitest run --root apps/server --maxWorkers=2` several times, alongside a second suite, and confirm it stays green. |
| nit | `apps/server/src/roles/worker.test.ts:619-631` | The "drain setup events" barrier is written inline. Other worker tests that create accounts or agents before `run()` have the same late-delivery exposure, but none of them count audits, so they aren't flaky today. | Optional: move it into a `kit.drainEvents()` helper in `worker.testkit.ts` so it can be reused. Not required for this task. |
| nit | `handoff/chatgpt/reports/010-report.md` (Summary) | It says the notifications "can be delivered after the worker subscribes" but doesn't say why: Postgres can deliver notifications from before a `LISTEN` to a first listener. | Optional: add one sentence so future readers don't move the setup code back before `start()` thinking that fixes it. |
