# Handoff protocol: ChatGPT

This folder is how the architect (Claude) hands work to ChatGPT and gets
results back. The human only says "bierz zadanie" (take a task).

## Files

- `STATUS.md`: the task board. Single source of truth for what to do next.
- `inbox/NNN-<slug>.md`: one task per file. Written by the architect only.
- `reports/NNN-report.md`: one report per task. Written by ChatGPT only.

## When the human says "bierz zadanie"

1. Read `handoff/chatgpt/STATUS.md` on branch `main`.
2. Take the first row with status `todo`. If there is none, reply
   "Brak zadań w inbox" and stop.
3. Read the task file from `inbox/` and every file it lists under "Read first".
4. Do the task exactly as written. Stay inside its scope. If something is
   unclear, make a reasonable assumption and record it in the report.
5. Write the report to `handoff/chatgpt/reports/NNN-report.md` using the
   template below. Put any other deliverables in the paths the task names.
6. Commit on a new branch `chatgpt/NNN-<slug>` and open a pull request to
   `main` titled `chatgpt: NNN <task title>`. Do not edit `STATUS.md` or
   `inbox/`, and do not touch files the task does not name.
7. Reply to the human in two or three sentences: task number, PR link, and
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
