# agent-band: projects and per-task git worktrees

Date: 2026-10-07. Goal: develop agent-band inside agent-band. Agents must work
in parallel on one repository without touching `main` or each other's files,
and a human (or reviewer agent) decides what gets merged.

## Project

`Project` (new module `projects`): id, orgId, name, slug, repoPath (absolute
path of a git repository), defaultBranch (detected, e.g. `main`),
worktreesRoot (default `<workspaceRoot>/<slug>/worktrees`), checks (list of
shell commands run after an agent finishes, e.g. `npm run format:check`,
`npm run lint`, `npm run typecheck`, `npm test`), createdBy, timestamps.
Creating a project validates the path is a git repo (`git rev-parse`).
The org baseline policy is not changed automatically; the UI offers
"allow agents to work in this project" which adds `worktreesRoot` to a chosen
policy (audited).

## Tasks in a project

- `Task.projectId?`. When set and `workDir` is not given, the worker, before
  starting the first run of the task, creates a worktree:
  `git worktree add <worktreesRoot>/<task key> -b ab/<task key> <base>`, where
  base is `defaultBranch` (or the goal's branch for subtasks, see below).
  `workDir` is set to that path. Later runs of the same task (continuations,
  retries, review fixes) reuse it.
- Goals in a project get branch `ab/<goal key>`; their subtasks branch off
  the goal branch and are merged into the goal branch (not `main`) on
  approval; the goal branch is merged into `main` at the end.
- Git identity is the agent's (already set via env).
- After the run finishes with `done`, the worker runs the project checks in
  the worktree (timeout 15 min each, output stored as a run artefact, exit
  codes recorded) and commits any uncommitted changes with message
  `<task key>: <task title>` authored by the agent. Task gets
  `review: { status: "pending" | "approved" | "rejected" | "merged" |
"conflict", checks: [{ command, exitCode, durationMs }], diffStat,
commits: [{ sha, subject }], baseSha, headSha }`.

## Review and merge

- `GET /tasks/:id/diff` (unified diff against base, size-capped, plus
  per-file stats).
- `POST /tasks/:id/review/approve` → merges `ab/<key>` into the base branch
  with `git merge --no-ff` in the project repo's base worktree (for `main`,
  the repo's own working tree must be clean; otherwise fail with a clear
  message); on conflict sets `review.status = conflict` and keeps the branch.
- `POST /tasks/:id/review/reject` with feedback → requeues the task (same
  worktree) with the feedback appended to the prompt (counts as an attempt).
- `POST /tasks/:id/review/request` → creates a review subtask for a reviewer
  agent (read-only, same worktree) whose result is attached to the review.
- `DELETE` / cleanup: after merge or cancel, remove the worktree and delete
  the branch (configurable keep).
- All actions audited (`project.*`, `review.*`), RBAC: approve/merge needs
  `agent.manage` on the task's agent scope or org admin.

## UI

- Projects screen (Execution section): list, create (repo path picker with
  validation, checks editor), details with open tasks and recent merges.
- New task / goal form: "Project" select (default: last used); folder field
  stays under Advanced.
- Board cards in a project show the branch and a review badge
  (checks passed/failed, awaiting review, merged, conflict).
- Task details: "Changes" tab with diff stat, file list and per-file diff,
  check results, commits, and Approve & merge / Request changes / Ask reviewer
  buttons.

## Tests

Real git in temp dirs (git is available in CI): worktree creation per task,
parallel tasks on separate branches, checks recorded, auto-commit by agent
identity, approve merges, conflict detection, reject requeues with feedback,
goal branch flow, cleanup, path validation, RBAC.
