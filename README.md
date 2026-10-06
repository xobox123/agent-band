# agent-band

A control plane for a fleet of AI coding agents: register provider accounts, create agents with their own identity and policy, and dispatch tasks to them. Every action is audited, and a local web UI shows what is running and how much of each account's limit is left.

## Requirements

- Node.js 22 or newer
- Docker (optional, for PostgreSQL in development)

## Quick start

```
npm install
npm run dev
```

The server listens on `127.0.0.1:4870` and the web UI on `127.0.0.1:5173`. Copy `.env.example` to `.env` to change settings.

## PostgreSQL

```
docker compose up -d db
```

Then set `DATABASE_URL=postgres://agent_band:agent_band@127.0.0.1:5432/agent_band`.

## Checks

```
npm run format:check
npm run lint
npm run typecheck
npm test
```

## Docs

- [Design spec](docs/superpowers/specs/2026-10-06-agent-band-design.md)
- [Architecture decision records](docs/adr)
- [AGENTS.md](AGENTS.md) for coding agent rules
