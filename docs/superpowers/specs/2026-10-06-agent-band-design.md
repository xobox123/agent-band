# agent-band: stage 1 design (engine + localhost UI)

Date: 2026-10-06

## Goal

A local control panel for a fleet of AI coding agents. The user registers
provider accounts (Claude, OpenAI), creates any number of agents bound to those
accounts, dispatches tasks to them, and sees at a glance which agents are
running, how many tokens each account consumed, and how much of each account's
limit is left.

Stage 1 delivers the engine and a web UI served on `localhost`. Later stages
(not in scope here):

- Stage 2: scheduler (cron-like recurring tasks, automatic resume after a limit
  window resets).
- Stage 3: leader agent that splits work, assigns it to other agents by label
  and reviews results.
- Stage 4: macOS app (Tauri wrapper around the same UI, menu bar icon,
  notifications).

## Product constraints

- Positioned as "one place to manage agents, budgets and schedules", not as a
  way to multiply subscription limits. Each account has an explicit purpose
  (label, scope), and limits are enforced, never bypassed.
- Two account types in the data model from day one:
  - `cli`: uses the user's locally installed `claude` / `codex` CLI, isolated
    per account by its config directory. Implemented in stage 1.
  - `api`: provider API key. Modelled in stage 1, adapter returns
    "not implemented".
- Everything runs on the user's machine. The HTTP server binds to `127.0.0.1`
  only. No telemetry.

## Stack

- TypeScript end to end, Node 22+ (developed on Node 25).
- Server: Fastify, SQLite via `better-sqlite3`, `zod` for validation.
- UI: React + Vite, served by the same Fastify process in production, Vite dev
  server in development.
- Tests: Vitest.
- Monorepo with npm workspaces: `packages/shared` (types, zod schemas),
  `packages/server`, `packages/web`.

## Data model

```
Account
  id, name, provider: "claude" | "openai", type: "cli" | "api",
  configDir?   (cli: CLAUDE_CONFIG_DIR / CODEX_HOME for this account)
  apiKeyRef?   (api: reference to the key, stored in macOS Keychain later;
                stage 1 stores it in the DB and never returns it over HTTP)
  labels: string[]
  limits: { dailyTokenBudget?: number, maxConcurrentRuns: number }
  createdAt

Agent
  id, name, accountId, model?, role: "leader" | "worker" | "reviewer",
  systemPrompt?, labels: string[]
  permissions:
    workDirs: string[]          (absolute paths the agent may run in)
    mode: "read-only" | "edit" | "full-auto"
    allowedTools?: string[]     (passed through to the CLI where supported)
    dailyTokenBudget?: number
  enabled: boolean
  createdAt

Task
  id, title, prompt, workDir,
  target: { agentId } | { label }   (label = any free enabled agent with it)
  priority: number, status: "queued" | "running" | "done" | "failed"
                            | "rate_limited" | "cancelled"
  createdAt

Run
  id, taskId, agentId, accountId, status, startedAt, finishedAt?,
  exitCode?, inputTokens, outputTokens, cachedTokens, costUsd?,
  rateLimitResetsAt?, error?
RunEvent
  id, runId, ts, kind: "text" | "tool" | "usage" | "rate_limit" | "error"
                       | "stderr", payload (JSON)
AccountUsageSnapshot
  id, accountId, ts, window: "5h" | "weekly", usedPercent, resetsAt
```

## Engine

### Queue / dispatcher

Single in-process loop, ticks on task creation, run completion and every few
seconds. For each queued task by priority:

1. Resolve candidate agents (explicit agent, or enabled agents with the label).
2. Skip agents that are busy, disabled, or whose account is at
   `maxConcurrentRuns`, over a daily token budget, or known rate-limited until
   a future `resetsAt`.
3. Check permissions: `task.workDir` must be inside one of the agent's
   `workDirs` (path-normalised, no `..` escape). Violations fail the task with
   a clear error, they are never silently widened.
4. Start a Run through the provider adapter.

Cancellation kills the child process (SIGTERM, then SIGKILL after 5 s).

On server start, runs left in `running` from a previous process are marked
`failed` with error "server restarted".

### Provider adapters

Common interface:

```ts
interface ProviderAdapter {
  start(ctx: RunContext): RunHandle   // spawns, returns handle
}
interface RunHandle {
  events: AsyncIterable<NormalizedEvent>
  cancel(): void
  done: Promise<{ exitCode: number }>
}
```

- Claude CLI: `claude -p <prompt> --output-format stream-json --verbose`,
  env `CLAUDE_CONFIG_DIR=<account.configDir>`, cwd `task.workDir`.
  Mode mapping: read-only -> `--permission-mode plan`, edit ->
  `--permission-mode acceptEdits`, full-auto -> `--permission-mode
  bypassPermissions` (UI shows a warning). `--model` and `--allowedTools`
  when set.
- Codex CLI: `codex exec --json --skip-git-repo-check <prompt>`, env
  `CODEX_HOME=<account.configDir>`, cwd `task.workDir`. Mode mapping:
  read-only -> `-s read-only`, edit -> `-s workspace-write`, full-auto ->
  `--full-auto`. `-m` when model is set. stdin is closed.
- API: stub that fails the run with "API accounts arrive in a later stage".

Each adapter has a pure parser `parseLine(line) -> NormalizedEvent[]`. Parsers
are tested against recorded sample outputs checked into
`packages/server/test/fixtures/`. The exact JSON shapes must be taken from real
recordings made with the installed CLIs, not assumed.

### Usage and limits

- Token counts come from usage events in the CLI stream and are summed into
  the Run.
- Codex: `rate_limits` data (primary 5 h window, secondary weekly window, with
  `used_percent` and `resets_at`) is stored as `AccountUsageSnapshot`.
- Claude: limit-reached messages are detected and turned into a
  `rate_limit` event with a reset time when the CLI provides one. Otherwise
  the UI shows token totals per window computed from Runs.
- A run that ends on a limit gets status `rate_limited`, its task goes back to
  `rate_limited`, and the account is marked unavailable until `resetsAt`.
  Automatic resume is stage 2.

## HTTP API (localhost only)

REST under `/api`: CRUD for accounts, agents, tasks; `POST /api/tasks/:id/cancel`;
`GET /api/runs?taskId=`; `GET /api/dashboard` (accounts with usage and limits,
agents with status). Live updates over one Server-Sent Events stream
`GET /api/events` (run events, status changes). Secrets are never returned.

## UI

- Dashboard: account cards with limit bars (5 h, weekly, daily budget) and
  token totals; agent list with status badge (idle, running, error,
  rate-limited).
- Accounts, Agents, Tasks: list + create/edit forms.
- Run view: live log stream, token counters, cancel button.

Plain, dense, readable. No design system beyond a small CSS file.

## Error handling

- CLI binary missing or account not logged in: run fails with an actionable
  message (e.g. "run `CLAUDE_CONFIG_DIR=... claude` and log in").
- Unparseable output lines are kept as `stderr`/`text` events, never crash the
  run.
- All input validated with zod at the HTTP boundary.

## Testing

- Unit: parsers (fixtures), dispatcher selection logic (fake adapter), path
  permission checks, limit accounting.
- Integration: HTTP API against an in-memory SQLite and a fake adapter that
  emits scripted events. No real tokens spent in tests.
- One manual smoke script that runs a trivial task on each real CLI.

## Out of scope for stage 1

Scheduler, leader orchestration, API adapters, Keychain, auth for the web UI,
multi-user, packaging as a Mac app.
