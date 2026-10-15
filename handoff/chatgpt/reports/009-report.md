# Report 009: Kill orphaned agent CLI processes after a server restart

Status: done

## Summary
Implemented persisted process ownership and detached CLI process-group tracking for agent runs. Worker startup now identifies lost runs by the original owner's hostname, PID, process start time and executable rather than relying exclusively on a stable worker ID, and cleans orphaned CLI process groups with a verified identity guard. Production shutdown cancels CLI runs rather than draining indefinitely. The implementation passed the GitHub Actions format, lint, typecheck and test checks on commit `ddf2fa823dbfa8e0f364ee140189907c8621f37f`.

## Done
- Added migration `0015_orphan_processes.sql` and schema metadata for worker owner identity, CLI PID/PGID/start time/executable, and the completed-cleanup timestamp.
- Exposed child PID and launched command via `RunHandle.process`; `spawnJsonLines` already used a detached process group.
- Added `process-table.ts` with portable `ps` inspection for macOS/Linux and guarded `SIGTERM` followed by `SIGKILL` after a grace period.
- Added run-module methods to record and mark cleaned processes, list running and pending-cleanup runs, and recover selected stale run IDs.
- Changed worker startup to detect owners from failed server processes, mark those runs failed and revoke their authorization, and retry process cleanup for terminal runs after an interrupted prior attempt.
- Ensured production service shutdown invokes `worker.stop({ force: true })`.
- Added `apps/server/src/runner/process-table.test.ts` and `apps/server/src/roles/worker.recovery.test.ts`.

## Not done (and why)
- No local test suite was executed, as required by the handoff protocol. GitHub Actions checked `format:check`, `lint`, `typecheck` and `test` successfully for the implementation.
- Crash recovery cannot terminate a process which was spawned but not yet persisted if the server crashes in that narrow window. Mitigating this completely would require holding the child before exec or implementing a durable supervisor handshake.
- A group whose original leader has exited but whose descendants remain cannot be safely signalled using the verified-leader-only strategy; it remains pending rather than risking a reused PID.

## Assumptions
- The worker and its orphaned CLI processes run on the same host; other hosts' records are never sent local OS signals.
- Linux and macOS provide `ps -p PID -o pid= -o pgid= -o lstart= -o comm=`, with `LC_ALL=C`.
- `workerId` can change across restarts and cannot safely identify an owner process by itself.

## Questions for the architect
- Should the next iteration close the spawn-to-persistence race with a hold-before-exec child supervisor?
- Should the system expose processes that cannot be safely cleaned in a dedicated operational alert?

## Suggested next tasks
- Add a durable process-supervisor handshake to eliminate the crash window between spawn and metadata persistence.
- Add a targeted Linux/macOS integration smoke test for process-group escalation and orphan grandchild behavior; continue using the fake process table in CI.

## CI verification
- `apps/server/src/runner/process-table.test.ts`: parse process identities; kill exactly a matching group; TERM->KILL escalation; reject PID reuse and nonleader PGIDs; report disappeared processes.
- `apps/server/src/roles/worker.recovery.test.ts`: reclaim orphan after worker ID changes; retry cleanup for an already terminal run; leave a live owner untouched.
- All existing runner and worker tests must remain green, including ordinary completion, user cancel, forced and draining stops, API stub runs and test databases after the new migration.
- CI must confirm `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test`. Tests were not run locally.
