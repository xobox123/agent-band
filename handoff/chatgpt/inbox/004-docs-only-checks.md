# 004: Docs-only changes run only the formatting check

Board task: AB-132. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `apps/server/src/modules/projects/` (project settings, checks, review gate)
- `packages/contracts/src/` (project and review DTOs)
- `handoff/chatgpt/README.md`

## Problem
After an agent finishes a project task, agent-band runs the full project
checks in the task worktree (deps, format:check, lint, typecheck, server and
web tests). For a change that only touches documentation this takes about
15 minutes and adds nothing.

## Goal
When the task diff (base SHA to head SHA) touches only documentation paths,
run a reduced check set instead of the full one.

## Requirements
1. Project setting `docsOnlyChecks`: `{ paths: string[] (globs), checks: string[] }`.
   Defaults: paths `["**/*.md", "docs/**", "handoff/**"]`, checks
   `["npx prettier --check <changed files>"]` (the changed file list is
   substituted by the server). Absent setting = current behaviour.
2. Decide the check set from the list of changed files in the diff. Mixed
   diffs (any non-docs file) run the full set.
3. Record on the review which set ran and why (`checkSet: "full" | "docs"`,
   shown in the Changes tab next to the checks).
4. Contracts (zod) updated, API docs updated, audit unchanged.
5. Tests: docs-only diff runs the reduced set; mixed diff runs the full set;
   empty setting keeps current behaviour; glob matching edge cases.

## Deliverables
Code and tests on branch `chatgpt/004-docs-only-checks`, report
`handoff/chatgpt/reports/004-report.md`.
