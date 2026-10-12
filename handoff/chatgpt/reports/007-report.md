# Report 007: Reassign a queued task to another agent

Status: done

## Summary
Added a task owner reassignment action with a validated `POST /tasks/:id/retarget` endpoint and a single database transaction protected by the task row lock. Eligible queued and scheduled tasks keep their status and schedule, while failed tasks are requeued for a fresh attempt. The previous target and new target are recorded in the tamper-evident audit log; eligibility is cleared so the worker can reconsider the task immediately. The task ID, working directory, project ID, branch, base branch and existing run history are preserved.

## Done
- Added `RetargetTaskBody` schema to shared contracts.
- Added a service use case that checks org owner permission and access to old/new targets, locks the task, rejects claimed/running/non-supported statuses with HTTP 409, updates the target, publishes `task.updated`, and records `task.retarget` with old/new target data.
- Added the HTTP route with work directory policy and goal leader validation.
- Added Reassign actions in the task details footer and Board card menu, and a modal picker for agent, group or label targets.
- Wired the picker through the web data source, mock data source, API client and event-driven refresh.
- Added `apps/server/src/modules/tasks/app/retarget.test.ts`: state transitions, eligibility reset, audit payload, scheduled metadata preservation, failed recovery, owner permission, and both race orderings.
- Added `apps/server/src/http/routes/retarget.test.ts`: route success, validation, claimed task conflict and role enforcement.
- Added `apps/web/src/screens/board/retarget.test.tsx`: card menu, picker selection, detail panel action and claimed card visibility.

## Not done (and why)
- Tests, typechecking, linting and formatting checks have not been executed in this chat, as the handoff protocol explicitly disallows running the test suite. CI and the review gate must validate the changes.

## Assumptions
- Reassigning a failed task immediately requeues the same task with attempt reset to 1, retaining its past run history and git worktree.
- Only org owners can use the action, consistent with the task's description of an owner action.
- Scheduled tasks retain their scheduled start and reset flag.
- Invalidation of cached eligibility and publishing `task.updated` is sufficient to make a queued task eligible for its next worker evaluation.
- Unchanged task paths are checked against the newly selected agent's policy when the target is a specific agent.

## Questions for the architect
- Should failed tasks instead remain failed until an explicit rerun? This implementation requeues them to make reassignment actionable immediately.
- Should admins or org-wide operators also be allowed to reassign, or owners only?

## Suggested next tasks
- CI should run `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`; review the UI test flow and PostgreSQL worker race semantics.
