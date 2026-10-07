# Backlog

Items found during stage 1 integration. Each is small and independent unless noted.

## API gaps found while building the web app (T12)

All 12 items and the empty-body fix are done (2026-10-07).

1. Effective policy: per-rule provenance (`rules[name] = { value, setBy: { level, policyId, version } }`) and per-rule enforcement coverage (`admission | runtime-hook | cli-sandbox | not-enforced` for the agent's provider), so the UI needs one request.
2. Effective skills: assignment origin (org/group/agent), pin, and a list of skills excluded by `allowedSkillIds`.
3. Run events: carry tool decisions. When the hook decides, append a `tool_decision` NormalizedEvent (decision, reason, toolUseId) to the run so the log can correlate it with the tool call; add `toolUseId` to `tool` events.
4. Tasks: `TaskDto.latestRun` (id, agentId, status, tokens, startedAt, finishedAt) and `eligibilityReason` while queued; board cards then need no extra `/runs` call.
5. `PATCH /agents/:id` accepts `groupIds` (set membership in one transaction, audited per change).
6. `GET /board` and `GET /tasks`: `accountId` filter, text search on key/title, paging (cursor) for done/failed/cancelled columns.
7. `GET /runs`: paging, time range, text search on task key/title.
8. Dashboard: availability reason per account (`concurrency_full | budget_exhausted | blocked | ok`), recent failures feed (last 10 failed runs), token totals for the last 24 h in hourly buckets.
9. Role bindings and skill assignments: filter by scope (`?agentGroupId=`, `?agentId=`).
10. Provider registry: export a closed list of provider ids in contracts; document the `accountFields` JSON Schema subset the UI supports.
11. Audit: `?involving=<principalId>` (actor OR target) for agent/user history views.
12. Agent avatar: structured `{ kind: 'initials' | 'color' | 'url', value }` instead of a free string.

## Other

- Real-CLI smoke script (`scripts/smoke.ts`) for Claude and Codex accounts, and README quick start with screenshots.
- Visual regression: Playwright screenshots of main screens in CI (system Chrome channel locally).
- Codex runtime enforcement: no pre-tool hook; evaluate Codex hooks when available (see `docs/research/cli-capability-matrix.md`).

- `POST /schedules/:id/run-now` (and other body-less POSTs) return 400 when sent with `content-type: application/json` and an empty body; accept an empty body.
- Timing-sensitive tests (server.test real process, outbox delivery, run-auth, execution route) fail under heavy machine load (load avg > 30); make waits event-driven or raise timeouts so the suite is reliable on busy machines and CI.
