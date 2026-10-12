# 008: Show why nothing runs: worker slots and blocked accounts

Board task: AB-129. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
Incident: the Board showed queued tasks and nothing In progress, while the cause was the global worker slot cap (AGENT_BAND_WORKER_SLOTS, default 4) or blocked accounts. Make this visible: expose worker capacity (slots, active runs, per account concurrency in use) in GET /system or similar and in the UI header/Board (e.g. 'Running 4/4 slots'); when a queued task is not claimed because all worker slots are busy, set its eligibilityReason to say so; Board column header shows a summary of blocked reasons (N waiting for account X reserve until HH:MM, M waiting for slots). Make worker slots configurable in Settings (persisted, applied without restart if feasible; otherwise documented). Default slots derived from the sum of account concurrency, capped. Tests.

## Deliverables
Code and tests on branch `chatgpt/008-show-why-nothing-runs-worker-slots-and-b`, report
`handoff/chatgpt/reports/008-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.

## Architect note (rework 1, PR #8)

Review of PR #8 requested changes. Fix every finding below, merge the latest main into your branch, push and wait for green CI, then mark the PR ready again.


**Summary.** Most of the work is there and looks sound: the `GET /system/worker-capacity` endpoint, the persisted `workerSlots` org setting with its zod contracts, the worker reading the limit on every loop pass (so changes apply without a restart), the `waiting for worker slots` reason, the header text `Running A/B slots`, the queue blocker summary on the Board, and the Settings field. Two problems block merging:

- **Broken migration chain.** The drizzle snapshot for 0015 points at the wrong parent migration. Its columns are correct; only the link back to 0014 is wrong.
- **Requirement not met.** The Board summary cannot show "waiting for account X reserve until HH:MM" for reserve blocks, because the server never puts the reset time into the reserve reason.

I could not run any tests: `node_modules` is not installed in this worktree, so vitest and drizzle-kit both failed to load. Everything below comes from reading the code, plus a node script that compared the 0014 and 0015 snapshots.

**Findings**

severity | file:line | issue | fix
---|---|---|---
High | apps/server/drizzle/meta/0015_snapshot.json:3 | `prevId` is `d319519a…`, which is the id of 0013. It should be 0014's id `429ba401-c24c-41c5-a559-495f76585e1b`. Now both 0014 and 0015 claim 0013 as parent, which `drizzle-kit check` reports as a collision. The new id `1616eeee-…0016` is also clearly hand-made. The tables do match: the only difference from 0014 is the new nullable integer column `organizations.worker_slots`, as in the SQL. | Regenerate with `drizzle-kit generate`, or set `prevId` to 0014's id and use a real UUID.
Medium | apps/server/src/roles/worker.ts:141 and apps/web/src/screens/board/BoardColumn.tsx:20 | Spec gap. The reserve reason reads `account <id>: reserve threshold reached (5h 92% >= 90%)` with no time. The `until …` regex only ever matches rate-limit reasons, so "reserve until HH:MM" never appears. The reason also includes the usage percent, which changes between checks, so tasks blocked by the same account land in separate groups. The board test passes only because it uses a made-up reason string that the server never produces. | In `describeUnavailable` for `reserve`, add ` until ${resetsAt}` (the reset time `reserveReached` already returns) and keep the varying percent out of the text used for grouping. Test against the real reason format.
Medium | apps/server/src/modules/tasks/app/tasks.ts:1005-1031 | `markWaitingForSlots` overwrites every ready queued task whose backoff has expired, and resets `checks: 0`. A task that keeps going between "slots full" and "account blocked" therefore has its backoff reset each cycle, so `markIneligible` never backs off. The account reason is also replaced by the slot reason even though the account is still blocked. | Keep the previous `checks` and leave account reasons alone. For example, only set the slot reason when `eligibility` is null or already a slot wait.
Medium | apps/server/src/roles/worker.ts:805-814 | The automatic path (sum of account concurrency, used when neither the setting nor the env var is set) is never tested in the worker. The testkit always passes `slots: 4`, so it never calls `listAccounts`, and that call depends on the dispatcher having `read` permission. If that permission is missing, the loop just logs "capacity check failed" and never claims anything. The automatic sum also counts paused accounts. | Add a worker test with `slots` unset. Count only active accounts.
Low | apps/server/src/http/r
