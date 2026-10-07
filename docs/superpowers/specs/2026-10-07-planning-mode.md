# agent-band: planning before execution (backlog, plan approval, pause)

Date: 2026-10-07. Requested by the product owner: plan first, start agents later.

## Backlog (draft tasks)

- Task status `draft`. Drafts are never claimed. Board gets a "Backlog" column first.
- Create as draft from the New task form (default "Add to backlog", second button "Create and start").
- Drafts are editable (title, prompt, workDir, target, priority, mode, runAt, maxAttempts, dependsOn); queued tasks are not.
- `POST /tasks/:id/start` and `POST /tasks/start` (bulk, ids[]) move drafts to `queued` (or `scheduled` when runAt is set), in one transaction for bulk, audited `task.start`.
- Dependencies between drafts are allowed and kept on start.

## Plan approval for goals

- Goal option `approval: "auto" | "required"` (default auto = current behaviour).
- With `required`: the planning turn runs with mode capped at `read-only`; subtasks created by the leader get status `draft` and `proposed: true`; after the turn the goal enters `awaiting_approval`.
- The goal details panel shows the plan (proposed subtasks with assignee, prompt, dependencies); the user can edit, delete or add subtasks, then `POST /goals/:rootTaskId/approve` moves all proposed drafts of the goal to queued and the goal to `waiting`; `POST /goals/:rootTaskId/reject` with feedback queues a new planning turn with the feedback appended (counts towards maxRounds).
- Audit: `goal.approve`, `goal.reject`, edits as usual. RBAC: approving requires `task.write` on the goal's leader scope.

## Pause

- `paused` flags on organization, account and agent (`PUT /pause` style endpoints or PATCH fields). The worker does not claim tasks that would run on a paused agent/account or while the org is paused; running runs continue. Header shows a global "Paused" banner with Resume; account and agent cards show paused state. Audited.

## UI

- Board: Backlog column with multi-select checkboxes and "Start selected"; card actions Start / Edit / Delete for drafts; proposed subtasks are marked "Proposed by <leader>".
- Goal details: plan review section with Approve / Request changes.
- New goal form: "Require plan approval" checkbox (default on for goals).
