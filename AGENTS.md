# AGENTS.md

Rules for any coding agent working in this repository. Spec: `docs/superpowers/specs/2026-10-06-agent-band-design.md`.

## Stack

TypeScript (strict), Node 22, npm workspaces. Fastify 5, zod, pino, Drizzle + PostgreSQL 17 (PGlite in tests), React 19 + Vite, Vitest.

- `apps/server`: Fastify app, modules, runner, process roles
- `apps/web`: React SPA
- `packages/contracts`: zod schemas and types shared by server and web
- `docs/adr`: architecture decision records

Relative imports use the `.ts` extension. The server runs through `tsx`.

## Module boundaries

- The server is a modular monolith. Each module owns its tables and exposes a public API in `index.ts`.
- Other modules use only that API or subscribe to its domain events. Never access another module's tables.
- Layers inside a module: `domain/` (pure logic, no I/O), `app/` (use cases, transactions, events), `infra/` (database, processes), `http/` (routes).
- Domain code is unit tested without a database.
- Workers talk to the rest of the system only through use cases and the database queue.
- Cross-module dependencies go through the interfaces in `apps/server/src/ports/`; tests use `ports/testing.ts` fakes.
- No foreign keys across module boundaries; every org-owned table has `org_id` and every query filters by it.

## Before every commit

All of these must pass:

```
npm run format:check
npm run lint
npm run typecheck
npm test
```

## Running tests under load

Several agents often run full suites at once, so the machine can be heavily oversubscribed.

- `npm test` runs the fast suites. `npm run test:slow` runs the real-process suite (`*.slow.test.ts`, spawns `npx tsx`); run it when you change boot, config or shutdown code. It is not part of the pre-commit check.
- Reproduce load locally by running two server suites in parallel: `npx vitest run --root apps/server --maxWorkers=2` in two terminals, then `npm test -w @agent-band/web`.
- Timeouts are ceilings, not expected durations (server 60s, web 30s, slow 120s). Do not shorten them and do not add per-test timeouts to work around a flaky test.
- Never wait with a fixed sleep. Use `waitFor` from `apps/server/src/roles/worker.testkit.ts`, a stream or event callback, or `findBy*` and `waitFor` in web tests. To prove that something did not happen, publish a later sentinel event and wait for it instead of sleeping.
- Web tests that use fake timers must restore real timers in `afterEach`.
- Use `openTestDatabase()` for PGlite: it restores a migrated snapshot per test instead of re-running migrations.

## Rules

- Tests never call a real `claude` or `codex` CLI or any paid API.
- Bind HTTP to `127.0.0.1` only.
- Never return secrets over HTTP or write them to logs.
- Comments in English, kept to a minimum.
- No em dashes in any text.
- Conventional commits in English. No AI attribution and no Co-Authored-By lines.
- Do only what your task asks. Do not touch `apps/server/test/fixtures/*`.
