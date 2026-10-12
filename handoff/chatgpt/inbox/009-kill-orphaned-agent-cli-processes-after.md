# 009: Kill orphaned agent CLI processes after a server restart

Board task: AB-130. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
After the server restarts (crash, launchd restart), agent CLI processes it spawned (agy, claude, codex) keep running as orphans: they keep consuming quota and calling /runs/:id/authorize-tool for runs that are already failed (seen 409s in logs). Track spawned processes per run (pid, process group, start time, command) in the database; spawn in a dedicated process group; on startup, for runs marked lost, terminate their process groups (SIGTERM, then SIGKILL after a grace period) if the pid still matches the recorded start time and command; on graceful shutdown terminate children. Coordinate with the lost-run recovery in roles/worker.ts. Tests with a fake process table.

## Deliverables
Code and tests on branch `chatgpt/009-kill-orphaned-agent-cli-processes-after`, report
`handoff/chatgpt/reports/009-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.

## Architect note (rework 1, PR #9)

Review of PR #9 requested changes. Fix every finding below, merge the latest main into your branch, push and wait for green CI, then mark the PR ready again.


The PR covers each part of the task on paper. It records the process group and identity in the database, the CLI already runs in its own process group, startup kills SIGTERM then SIGKILL after checking start time and command, shutdown now cancels children, and the tests use a fake process table. Two problems remain. The drizzle snapshot for the new migration is missing. And the identity check probably fails for the real CLIs this task is about (agy, claude, codex), which would make the cleanup quietly do nothing in production.

I could not run the targeted tests: this worktree has no `node_modules` (vitest stopped with `ERR_MODULE_NOT_FOUND`). Running `ps` to check the real output format needed approval, so that is also unchecked. Everything below comes from reading the code; CI is green on this commit.

**Findings** (severity | file:line | issue | fix)

1. **High** | `apps/server/drizzle/meta/` (no `0015_snapshot.json`) | Migration `0015_orphan_processes` was added to `_journal.json` and the schema, but its snapshot was not. Every earlier migration (0000 to 0014) has one. The next `drizzle-kit generate` will compare against 0014 and generate `owner`, `process` and `process_reaped_at` a second time. The drizzle meta does not match the schema. | Generate the 0015 snapshot with `drizzle-kit generate` and keep the generated SQL, or write it by hand from 0014 plus the three columns.

2. **High** | `apps/server/src/roles/worker.ts:557-565`, `apps/server/src/runner/process-table.ts:76` | The process name (`ps comm`) is read right after spawn and must match exactly later. Node-based CLIs started through `#!/usr/bin/env node` show `env`, then `node`, then often rename themselves (Claude sets `process.title`, which changes the name on Linux). An orphan found at restart then counts as `mismatch`: it is never signalled and never marked cleaned up. So the main scenario in the task can silently do nothing. | Identify a process by pid + pgid + start time only (pid plus start time is already unique). Or re-read the name before matching and treat a name change as allowed. Add a test where the name changes between recording and cleanup.

3. **Medium** | `apps/server/src/roles/worker.ts:875` | Recovery skips any run whose `owner.host` differs from `os.hostname()`. On macOS (the launchd target) the hostname can change with the network (for example `Foo.local` vs a DHCP-assigned name). After such a change, runs from the previous boot are never recovered and their tasks stay `running` forever. The old code recovered them by matching `workerId`. | When the host differs, fall back to the `workerId` match, or store a stable machine id instead of the hostname.

4. **Medium** | `apps/server/src/roles/worker.ts:556-566` | Some errors happen before the event loop starts: `processTable.read` fails, the child is not its group leader, or `recordProcess` throws `run_terminal` (for example after a concurrent cancel). The error leaves `attempt` without `h.cancel()`, so the CLI keeps running unrecorded, which recreates the orphan. In the `recordProcess` case, `registered` is already set, so `markProcessReaped` throws `process_changed` and the problem only appears as a warning. | Call `h.cancel()` in a catch around the registration, and set `registered` only after `recordProcess` succeeds.

5. **Medium** | `apps/server/src/roles/worker.ts:576`, `apps/server/src/runner/process-table.ts:80` | When the CLI exits on its own, `cleanProcess` reads only the leader's pid. The le
