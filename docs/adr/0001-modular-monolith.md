# 0001: Modular monolith, split-ready

## Context

Stage 1 runs on one machine, but later stages add a scheduler, a leader agent, a desktop app and a team mode with remote runners. The architecture must not block them, and a premature microservice split would add cost now.

## Decision

One TypeScript codebase organised as modules (identity, accounts, agents, policy, tasks, runs, usage, audit, runner). Each module owns its tables and exposes a public API in `index.ts`. Cross-module access goes only through that API or domain events. Inside a module: `domain/`, `app/`, `infra/`, `http/`. The same build starts as role `api`, `worker` or `all`, selected by `AGENT_BAND_ROLE`.

## Consequences

- Simple to run and test locally as a single process.
- Modules can be extracted into services later without rewriting their contracts.
- Boundaries are enforced by convention and review, so they need to be checked actively.
- Workers use the use-case boundary, which lets them become remote runners in stage 5.
