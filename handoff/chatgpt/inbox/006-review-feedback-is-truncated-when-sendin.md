# 006: Review feedback is truncated when sending changes back

Board task: AB-64. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
POST /tasks/:id/review/reject rejects long feedback (validation) and callers truncate it, so authors lose findings (seen in production with AB-55 losing finding 7). Raise the feedback limit (e.g. 50k), or better: store the full reviewer report on the task review record and reference it from the requeued prompt instead of copying text; show the full findings in the Changes tab. Tests.

## Deliverables
Code and tests on branch `chatgpt/006-review-feedback-is-truncated-when-sendin`, report
`handoff/chatgpt/reports/006-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.
