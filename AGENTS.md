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

## Before every commit

All of these must pass:

```
npm run format:check
npm run lint
npm run typecheck
npm test
```

## Rules

- Tests never call a real `claude` or `codex` CLI or any paid API.
- Bind HTTP to `127.0.0.1` only.
- Never return secrets over HTTP or write them to logs.
- Comments in English, kept to a minimum.
- No em dashes in any text.
- Conventional commits in English. No AI attribution and no Co-Authored-By lines.
- Do only what your task asks. Do not touch `apps/server/test/fixtures/*`.
