# agent-band: stage 3 design (leader agents and delegation)

Date: 2026-10-07. Builds on stage 1 and stage 2 specs.

## Goal

A human gives a leader agent a goal. The leader splits it into subtasks,
delegates them to other agents (by agent, label or group), reviews results,
and reports. Delegation never widens permissions, everything is attributed
and audited, and the whole tree has one budget.

## Concepts

- **Goal task**: a normal task whose target is an agent with role `leader`
  (or a label/group resolving to one). It gets `kind: "goal"`.
- **Subtask**: a task created by a leader during a goal; `parentTaskId` and
  `rootTaskId` link it into a tree. `createdBy` is the leader principal.
- **Turns**: a leader does not idle while children work. Each leader turn is
  a normal run. The tree advances by events:
  1. Planning turn: the leader inspects the goal and creates subtasks
     through tools, then ends its turn.
  2. When all open subtasks of the goal are terminal (or one fails, per
     `onChildFailure`), the orchestrator queues a **continuation turn** for
     the leader with a structured summary of child results. For Claude the
     continuation resumes the previous session (`--resume <sessionId>`);
     for other providers the summary is passed in the prompt.
  3. The leader may create more subtasks (another round), request a review,
     or finish by calling `complete_goal(summary)`.
  - Limits per goal: `maxRounds` (default 5), `maxSubtasks` (default 20),
    `maxDepth` (default 1: subtasks cannot delegate further), `treeTokenBudget`.

## Delegation tools (MCP)

agent-band exposes an MCP server (streamable HTTP at
`/api/v1/mcp`, authenticated by the per-run token from stage 1) that the
runner attaches to leader runs only: Claude via an `.mcp.json` in the per-run
plugin directory, Codex via `-c mcp_servers.agent_band...` (verified at
implementation; fall back to "leader not supported on this provider").

Tools:

- `list_agents(filter?)`: agents the leader may delegate to (name, handle,
  role, labels, groups, model, status, availability), never secrets.
- `create_subtask({ title, prompt, workDir, target, priority?, mode?,
dependsOn? })`: returns the subtask key.
- `list_subtasks()`, `get_task(key)`: status, result summary, run stats.
- `request_review({ subtaskKey, reviewerTarget, instructions })`: creates a
  review subtask for an agent with role `reviewer`.
- `complete_goal({ summary, outcome: "success" | "partial" | "failed" })`.
- `post_note(text)`: appended to the goal timeline.

Every tool call is authorized by the run token and recorded in the audit
log with the leader as actor (`delegation.*` actions).

## Policy rules for delegation (new, most-restrictive merge)

- `canDelegate: boolean` (default false; leader role alone is not enough).
- `delegateTargets: { agentIds?, labels?, groupIds? }`: who the leader may
  assign work to (intersection across levels).
- `maxSubtasks`, `maxRounds`, `treeTokenBudget` (min across levels).
- Subtask constraints: a subtask's `workDir` must be inside the goal's
  `workDir`; its requested `mode` is capped by the leader's effective
  `maxMode`; the assignee's own policy still applies at run start (the
  effective rules for a subtask run are the assignee's policy, and the
  subtask cannot request more than the leader has). No permission is ever
  widened by delegation.

## Data model changes (tasks module)

`Task`: `kind: "task" | "goal" | "review"`, `parentTaskId?`, `rootTaskId?`,
`depth`, `dependsOn: taskId[]` (a subtask is not claimable until its
dependencies are done), `result?: { summary, outcome }`.
`GoalState` (new table, tasks module): `rootTaskId`, `round`,
`leaderAgentId`, `leaderSessionId?`, `status: planning | waiting |
continuing | completed | failed`, `treeTokensUsed`, limits snapshot.

A worker finishing a subtask run stores a result summary: the last assistant
text of the run, truncated to 4 KB.

## Orchestrator

A loop next to the scheduler (same leader lock): when a goal in `waiting`
has no open subtasks, queue the continuation turn; enforce `maxRounds`,
`treeTokenBudget` (sum of tokens of all runs in the tree; exceeding it cancels
open subtasks and fails the goal with a clear reason), and dependency release.

## UI

- Board: goal cards show a progress bar (done/total subtasks) and expand to
  child cards; subtasks show their parent key.
- Goal details panel: tree view (subtasks with assignee, status, tokens),
  timeline (leader notes, rounds, reviews), tree token budget bar, final
  summary.
- New task form: "Goal for a leader" option with limits.

## Testing

Delegation tool authorization (token, canDelegate, delegateTargets);
no-widening rules (workDir, mode); dependency gating; continuation after
children finish; maxRounds/maxSubtasks/budget enforcement; MCP server
protocol tests; full goal flow with FakeAdapter scripting a leader that
calls tools through a fake MCP client; one manual smoke with real Claude as
leader and two worker agents.

## Out of scope

Leaders delegating to leaders (depth > 1), cross-org delegation, human
approval gates (stage 5 team mode), merging code from subtasks automatically
(subtasks work in the same workDir or separate git worktrees chosen by the
leader; automatic worktree management is a later item).
