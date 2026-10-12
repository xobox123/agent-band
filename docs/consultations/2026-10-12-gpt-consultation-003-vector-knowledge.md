# GPT Consultation 003: Vector knowledge for Agent Band

Date: 2026-10-12
Source: Direct product owner request in ChatGPT
Status: **Design requested explicitly; implementation and roadmap changes are not approved**

## Owner request and context

The owner asked how shared vector memory could work for Claude, Gemini and other Agent Band agents. Following discussion, the owner explicitly requested: "Opracuj design wdrożenia vector bazy do agent banda. Odczytaj GitHuba i protokół i dodaj wszystko zmiany".

Interpreted scope: prepare a technical implementation design in the repository for architect review, not silently implement a new production subsystem. Follow the existing GitHub workflow: work on a topic branch, use a PR, do not write to main and do not modify architect-owned handoff task assignments.

The product goal is useful project context across different agents and model providers, without assuming that any individual LLM has a durable memory or can read the database directly.

## Linked proposal

Full design: [Agent Band vector knowledge and retrieval](../superpowers/specs/2026-10-12-vector-knowledge.md).

This proposal covers:

- Local-first PostgreSQL/PGlite with optional pgvector, rather than a required separate database.
- Project-scoped, authenticated retrieval through the existing run/MCP mechanisms.
- Explicit source selection, bounded indexing, provenance and deletion.
- Hybrid lexical + semantic retrieval, model versioning and auditable run context.
- Clear isolation between indexed project reference context and the earlier curated AgentMemory specification.
- Feature-gated database migrations, negative permission tests and phased rollout candidates.

## Current implementation and conflicts to resolve

- Current code uses a modular monolith and Drizzle migrations with both PostgreSQL and PGlite. Vector rollout must not break installations lacking pgvector.
- The earlier [AgentMemory specification](../superpowers/specs/2026-10-07-agent-chat-memory.md) defines short approved per-agent memories injected into prompts. It does **not** define semantic project retrieval and excludes group/org memory.
- Current RBAC scopes do not include projects, so project-scoped retrieval must not ship to multi-user or remote agents without explicit authorization rules.
- Current tool setup is run-bound and delegation-centric. Shared agent-accessible retrieval requires new adapters and contracts.
- No evidence was found of an already implemented knowledge/memory module on the inspected main branch. A specification is not proof of delivery.

## Requests for the architect

1. Review the proposed scope critically against the current implementation, AgentMemory and planned Task Composer.
2. Decide whether the first milestone should be source registry plus lexical retrieval, or whether vector indexing must ship in the first version.
3. Decide default disabled/opt-in behavior, local embedding model choice, project access rules and migration strategy.
4. If approved, convert the design into small task files through the architect-owned handoff process. Do not modify handoff/STATUS.md from this consultation.
5. Require verified CI, retrieval citations, multi-tenant isolation tests and explicit consent prior to activation.
6. Record accepted decisions in an ADR before implementing the storage integration.

## Decisions not yet made

Embedding model/dimension, API vs local-only provider, exact user-visible memory UI, extension installation model, project ACL, indexing default, retention requirements, and hosted MCP access remain open.

This document records the owner's design request and a candidate solution. It is **not** approval to change the roadmap or create/execute implementation tasks.
