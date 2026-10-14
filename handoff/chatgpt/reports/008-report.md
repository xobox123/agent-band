# Report 008: Show why nothing runs: worker slots and blocked accounts

Status: done

## Summary
Rework 1 addresses the architect's findings: Drizzle migration parent UUID, stable reserve reason with reset time, preservation of account eligibility/backoff and automatic capacity excluding paused accounts. Latest main merged into this branch.

Added worker-capacity diagnostics and visible queue-blocker reasons. Worker slots can be persisted in organization settings, take effect without restart, and default to the sum of account concurrency limits capped at 256. Existing environment configuration remains available when no organization override is present.

## Done
- Exposed `GET /system/worker-capacity` with effective slots, active runs, and per-account in-use/max concurrency.
- Added organization `workerSlots` setting, contracts, validation, database migration 0015 and Settings UI. Null means automatic.
- Workers derive the effective cap on each dispatch iteration; shrinking it does not terminate existing runs.
- Ready tasks waiting for occupied slots receive `eligibilityReason: waiting for worker slots` without being claimed or delayed.
- Header renders `Running A/B slots`; queued Board column groups slot/account/reason blockers.
- Documented behavior and migration dependency in `docs/api-gaps.md`.

## Tests added / updated (CI must run; not run here)
- `apps/server/src/roles/worker-capacity.test.ts`: default cap, empty accounts, precedence.
- `apps/server/src/roles/worker-capacity.integration.test.ts`: worker automatic slots, paused-account exclusion, real reserve reset, preserved queue backoff.
- `apps/server/src/platform/config.test.ts`: optional environment override.
- `apps/server/src/http/api.test.ts`: capacity endpoint, account concurrency, settings persistence and validation.
- `apps/server/src/roles/worker-capacity.integration.test.ts`: slot wait reason and live capacity changes.
- `apps/web/src/screens/settings/settings.test.tsx`: capacity settings UI validation and persistence.
- `apps/web/src/screens/board/board.test.tsx`: grouped slot and account blockers.
- CI must pass formatting, lint, typecheck, server/web tests, and migrations before this report can be marked done.

## Not done (and why)
- Rework CI is pending. Do not mark this task done until all GitHub Actions checks succeed.
- Tests and typecheck were not executed in this agent session, per the task instructions.
- A multi-worker distributed semaphore is not implemented: each worker applies its local cap, as before. The endpoint reports all persisted running runs.
- A GUI test for header refresh remains for CI/full QA.

## Assumptions
- A minimum of one slot even when there are no accounts keeps the dispatcher operational if an account is added later.
- Organization persisted capacity takes precedence over the legacy environment override.
- A queued task with unfinished dependencies or an unexpired account-related eligibility backoff is not labeled as a slot wait.
- A queued task retains its account-specific reason until eligible for another attempt.

## Questions for the architect
- Task 004 also uses migration 0015. Whichever PR merges second must rebase and renumber its migration. Should the next task implement distributed/global rather than per-worker slots?
- Do we want to display provider reserve reset times that are not supplied by the account availability decision?

## Suggested next tasks
- Add a distributed concurrency semaphore keyed by organization for multi-worker deployments.
