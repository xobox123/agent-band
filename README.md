# agent-band

A control plane for teams using Claude Code and Codex: local execution, enforced permissions, and a record of every approved change. Register your provider accounts, create agents that each have their own identity and policy, dispatch or schedule tasks to them, and see what is running and how much of each account's limit is left. It is one place to manage agents, their permissions, budgets and schedules, not a way to multiply subscription limits.

Everything runs on your machine. HTTP binds to `127.0.0.1` only and there is no telemetry.

## Features

Stage 1 (engine and local UI):

- Provider accounts for the Claude Code and Codex CLIs, one login per account (config directory isolation). agent-band never reads or stores session credentials.
- Agents as first-class identities (`agent:<slug>`) with their own model, persona, system prompt, labels, groups and git author.
- Versioned policies: allowed work directories, maximum permission mode, tool allow and deny lists, run time limit, daily token budget. Policies merge from organisation to group to agent, and every decision is recorded.
- Task board (kanban) with priorities P0 to P3, manual ordering, and targets by agent, label or group.
- Runtime tool enforcement for Claude Code through a pre-tool hook, with fail-closed behaviour.
- Skill library: import, version, pin and assign skills at organisation, group or agent level.
- Usage dashboard: tokens per account and agent, 5 hour and weekly limit windows, daily budgets, concurrency.
- Tamper-evident audit log: append-only and hash-chained, with chain verification and JSONL export.
- Live updates over SSE, REST API with OpenAPI at `/api/openapi.json`.

Stage 2 (scheduler):

- Cron schedules (with time zone) that create tasks from a template, with overlap handling (`skip` or `queue`), run now and a next-fire preview.
- One-off tasks with a future `runAt`.
- Automatic resume of rate-limited tasks after the limit window resets.

## Screenshots

Board:

![Board](docs/images/board.png)

Dashboard:

![Dashboard](docs/images/dashboard.png)

Agents:

![Agents](docs/images/agents.png)

Schedules:

![Schedules](docs/images/schedules.png)

Audit log:

![Audit log](docs/images/audit.png)

## Requirements

- Node.js 22 or newer
- The `claude` and/or `codex` CLI installed and logged in, on the machine that runs the worker
- Docker (optional, only for a real PostgreSQL instead of the embedded PGlite)

## Quick start

```
npm install
npm run build -w @agent-band/web
npm start
```

Open http://127.0.0.1:4870. By default the server runs the `all` role (API and worker in one process) and keeps its data in an embedded PGlite database under `~/.agent-band`.

## Adding accounts

Log in with the provider's own CLI, then register the account in the UI (Accounts) or through the API, pointing it at the config directory that holds that login.

The default directory needs no environment variable:

```
claude          # logs in to ~/.claude
codex login     # logs in to ~/.codex
```

For additional accounts use a separate directory per account:

```
CLAUDE_CONFIG_DIR=~/.claude-work claude
CODEX_HOME=~/.codex-work codex login
```

Then create the account with `configDir` set to `~/.claude-work` (or `~/.codex-work`). When the config directory is the default one, agent-band leaves `CLAUDE_CONFIG_DIR` and `CODEX_HOME` unset for the child process, because setting them changes where the CLI looks up its login.

## Permission modes

Each task runs in one of three modes. The effective mode is capped by the policy's `maxMode`.

| Mode        | Claude Code flag                      | Codex flag              | Meaning                           |
| ----------- | ------------------------------------- | ----------------------- | --------------------------------- |
| `read-only` | `--permission-mode plan`              | `-s read-only`          | Read and plan, no edits           |
| `edit`      | `--permission-mode acceptEdits`       | `-s workspace-write`    | Edit files in the workspace       |
| `full-auto` | `--permission-mode bypassPermissions` | `-s danger-full-access` | No confinement, owner opt-in only |

The organisation baseline policy "Default" caps agents at `edit`; raising it to `full-auto` is an explicit, audited change.

What is enforced per provider:

| Policy rule                   | Claude Code                                    | Codex                                          |
| ----------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `maxMode`                     | CLI permission mode                            | CLI sandbox                                    |
| `workDirs`                    | Admission, plus pre-tool hook for path tools   | Admission, plus workspace-write sandbox        |
| `allowedTools`, `deniedTools` | CLI flags and pre-tool hook                    | Not enforced at runtime                        |
| `maxRunMinutes`               | Runner deadline, kills the whole process group | Runner deadline, kills the whole process group |
| `dailyTokenBudget`            | Checked before each run                        | Checked before each run                        |
| `allowedSkillIds`             | Admission                                      | Admission                                      |

Reads outside the work directories through shell commands are not confined. The UI marks rules a provider cannot enforce instead of pretending. Details and sources are in [docs/research/cli-capability-matrix.md](docs/research/cli-capability-matrix.md).

## Configuration

Environment variables, validated at startup:

| Variable                           | Default                   | Description                                                  |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------ |
| `AGENT_BAND_PORT`                  | `4870`                    | HTTP port, bound to `127.0.0.1`                              |
| `AGENT_BAND_ROLE`                  | `all`                     | Process role: `api`, `worker` or `all`                       |
| `AGENT_BAND_HOME`                  | `~/.agent-band`           | Data directory                                               |
| `AGENT_BAND_WORKER_SLOTS`          | `4`                       | Concurrent runs per worker (1 to 256)                        |
| `AGENT_BAND_WORKER_ID`             | generated                 | Worker name shown on runs                                    |
| `AGENT_BAND_SCHEDULER_INTERVAL_MS` | `15000`                   | Scheduler tick interval (100 to 3600000)                     |
| `DATABASE_URL`                     | unset                     | PostgreSQL URL; when unset, embedded PGlite is used          |
| `PGLITE_DIR`                       | `$AGENT_BAND_HOME/pgdata` | PGlite data directory                                        |
| `LOG_LEVEL`                        | `info`                    | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

For PostgreSQL:

```
docker compose up -d db
DATABASE_URL=postgres://agent_band:agent_band@127.0.0.1:5432/agent_band npm start
```

## Process roles

The same build runs in one of three roles, selected with `AGENT_BAND_ROLE`:

- `all` (default): API and worker in one process, for local use.
- `api`: HTTP API, SSE and the scheduler, no task execution.
- `worker`: claims queued tasks from the database and runs the CLIs. It must run where `claude` and `codex` are installed. Several workers can share one PostgreSQL database safely.

## Development

```
npm run dev        # server with watch on :4870, web UI with Vite on :5173
npm test
npm run format:check
npm run lint
npm run typecheck
```

Tests use PGlite and fake adapters, and never call a real CLI. Tests that need real PostgreSQL run only when `TEST_DATABASE_URL` is set:

```
docker compose up -d db
TEST_DATABASE_URL=postgres://agent_band:agent_band@127.0.0.1:5432/agent_band npm test
```

A manual smoke test drives a real CLI end to end and spends real tokens, so it never runs in CI or `npm test`:

```
npx tsx scripts/smoke.ts --provider claude
npx tsx scripts/smoke.ts --provider openai --config-dir ~/.codex-work
```

See [AGENTS.md](AGENTS.md) for the rules coding agents follow in this repository, [docs/adr](docs/adr) for architecture decisions and the [design spec](docs/superpowers/specs/2026-10-06-agent-band-design.md) for the full design.

## Roadmap

- Stage 3: leader agent that splits work, assigns it to other agents by label and reviews results.
- Stage 4: macOS app (Tauri wrapper, embedded database, menu bar, notifications).
- Stage 5: team mode with multi-user authentication, remote runners on developer machines and a hosted control plane.
