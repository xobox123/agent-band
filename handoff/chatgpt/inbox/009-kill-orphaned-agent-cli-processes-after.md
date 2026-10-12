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
