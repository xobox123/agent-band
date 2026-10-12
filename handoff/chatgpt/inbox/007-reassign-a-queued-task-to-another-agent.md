# 007: Reassign a queued task to another agent

Board task: AB-128. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
Today a queued task cannot change its target (PATCH /tasks/:id only edits drafts), so when an account is blocked (reserve, rate limit) the owner cannot move queued work to a free account without cancelling it, and cancelling a project task deletes its worktree. Add an owner action to change target (agent, group or label) of a task in queued/scheduled/failed state: contracts, route (POST /tasks/:id/retarget), service with task lock and claim race handling (409 if it got claimed meanwhile), audit task.retarget with old/new target, eligibility recomputed immediately, a 'Reassign' control in the task panel and in the Board card menu with the agent picker. Project worktree and branch are kept. Tests for service, race, route, UI.

## Deliverables
Code and tests on branch `chatgpt/007-reassign-a-queued-task-to-another-agent`, report
`handoff/chatgpt/reports/007-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.
