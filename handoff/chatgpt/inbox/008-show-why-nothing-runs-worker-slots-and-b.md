# 008: Show why nothing runs: worker slots and blocked accounts

Board task: AB-129. Write in English (code, comments, report).

## Read first
- `AGENTS.md`
- `handoff/chatgpt/README.md`
- the source files named below

## Task
Incident: the Board showed queued tasks and nothing In progress, while the cause was the global worker slot cap (AGENT_BAND_WORKER_SLOTS, default 4) or blocked accounts. Make this visible: expose worker capacity (slots, active runs, per account concurrency in use) in GET /system or similar and in the UI header/Board (e.g. 'Running 4/4 slots'); when a queued task is not claimed because all worker slots are busy, set its eligibilityReason to say so; Board column header shows a summary of blocked reasons (N waiting for account X reserve until HH:MM, M waiting for slots). Make worker slots configurable in Settings (persisted, applied without restart if feasible; otherwise documented). Default slots derived from the sum of account concurrency, capped. Tests.

## Deliverables
Code and tests on branch `chatgpt/008-show-why-nothing-runs-worker-slots-and-b`, report
`handoff/chatgpt/reports/008-report.md`. You cannot run the tests: list in
the report which tests you added and what CI must confirm.
