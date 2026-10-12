# Report 010: Flaky worker eligibility test under load

Status: done

## Summary
The intermittent extra `task.ineligible` audit is caused by a setup notification race. The account and agent are created before the worker starts, but their outbox notifications can be delivered after the worker subscribes. That delayed agent/account event invokes `recheck()`, clearing the ghost task's stored eligibility and allowing a second `task.ineligible` audit. The test now drains setup notifications through an explicit outbox sentinel before starting the worker.

## Done
- Updated the existing test `does not churn claims or audit rows for a task with no eligible agent, and picks it up once one exists` in `apps/server/src/roles/worker.test.ts`.
- Started the event stream during test setup, subscribed to a dedicated sentinel, and published that sentinel after creating the account, agent and ghost task.
- Waited for delivery of the sentinel using the existing `waitFor` helper, then started the worker. This is an event-ordering barrier rather than an arbitrary delay.
- Left all original assertions intact, including exactly one `task.ineligible` audit, zero claim/release audits and eventual execution once a matching agent exists.
- Made no production changes because the behavior under test is intentional: changes to agent/account eligibility should trigger immediate reevaluation.

## Not done (and why)
- Did not execute the tests locally. The handoff protocol explicitly says tests cannot run in this agent environment, even though the task requests repeated load runs.
- CI and the agent-band review gate must verify formatting, lint, typecheck and the server suite under parallel load.

## Assumptions
- The event stream delivers committed outbox notifications in order, so delivery of the later sentinel proves that the earlier account and agent setup events have already been delivered.
- No account or agent changes occur between that synchronization point and the initial eligibility check.

## Questions for the architect
- None.

## Suggested next tasks
- Run `npx vitest run --root apps/server --maxWorkers=2` several times, including while another server suite is running; confirm this test consistently reports one `task.ineligible` audit.
- Run `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test` in CI.
