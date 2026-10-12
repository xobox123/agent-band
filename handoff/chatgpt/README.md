# Handoff protocol: ChatGPT

This folder is how the architect (Claude) hands work to ChatGPT and gets
results back. The human only says "bierz zadanie" (take a task).

## Files

- `STATUS.md`: the task board. Single source of truth for what to do next.
- `inbox/NNN-<slug>.md`: one task per file. Written by the architect only.
- `reports/NNN-report.md`: one report per task. Written by ChatGPT only.

## When the human says "bierz zadanie"

1. Read `handoff/chatgpt/STATUS.md` on branch `main`.
2. Take the first row with status `todo` that nobody has claimed yet. A task
   is claimed when an open pull request from a branch `chatgpt/NNN-*` exists
   (several ChatGPT chats may work in parallel). If there is none, reply
   "Brak zadań w inbox" and stop.
3. Claim it right away: create the branch `chatgpt/NNN-<slug>` and open a
   draft pull request to `main` titled `chatgpt: NNN <task title>` before you
   start the work. If such a PR appeared in the meantime, pick the next task.
4. Read the task file from `inbox/` and every file it lists under "Read first".
5. Do the task exactly as written. Stay inside its scope. If something is
   unclear, make a reasonable assumption and record it in the report.
6. Write the report to `handoff/chatgpt/reports/NNN-report.md` using the
   template below. Put any other deliverables in the paths the task names.
7. Commit to that branch and mark the pull request ready for review. Do not
   edit `STATUS.md` or `inbox/`, and do not touch files the task does not
   name. You cannot run the test suite: say so in the report and list what
   should be tested. CI and the agent-band review gate run the checks.
8. The task is finished only when the GitHub Actions CI check on your pull
   request is green. Before you start, merge the latest `main` into your
   branch. After each push, read the check result on the PR; if it fails,
   read the failing step, fix it and push again. Never report a task as done
   with a red or pending CI. If CI fails for a reason outside your task,
   say so in the report and in the PR description.
9. If more `todo` tasks are unclaimed and you still have room in this chat,
   continue with the next one. Otherwise stop.
10. Reply to the human in two or three sentences: task number, PR link, and
   whether everything was done.

## Report template

```markdown
# Report NNN: <task title>

Status: done | partial | blocked

## Summary
Two to five sentences.

## Done
- ...

## Not done (and why)
- ...

## Assumptions
- ...

## Questions for the architect
- ...

## Suggested next tasks
- ...
```

## Rules

- Write in Polish unless the task says otherwise. Code and file names in English.
- No em dashes.
- Cite sources with links when you use the web.
- Never commit secrets. Never push to `main` directly.
