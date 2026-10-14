# Agent Band: vector knowledge and retrieval design

Date: 2026-10-12
Status: **Proposed design, not approved implementation**
Requested by: product owner
Scope: technical design and rollout proposal. No runtime behavior or roadmap is changed by this document.

## 1. Decision to make

Add an optional, local-first **Knowledge & Retrieval** capability to Agent Band, grounded in project sources and available to agent runs through authenticated tools. Store canonical text and metadata in the existing PostgreSQL/PGlite data store, with pgvector for semantic similarity. Start with **project-scoped retrieval**, not an unrestricted shared memory that all agents can read.

This is a proposal to the architect and owner, not an implementation authorization. Confirm the defaults and security model before implementation.

### Goals

- Provide relevant, attributable project context to Claude Code, Codex and future Gemini runs without copying entire transcripts into prompts.
- Support semantic + lexical search over explicit, consented sources: project docs, selected repository files and approved summaries/decisions.
- Preserve local-first operation, no telemetry, no credentials forwarded to an embedding provider without explicit opt-in.
- Enforce organization/project/run boundaries and source-level visibility before releasing any text to a model.
- Make provenance, revision, deletion, reindexing, cost and failure visible. Never treat retrieved text as instructions or authority.
- Reuse existing DB, module boundaries, authorization, run lifecycle, and MCP wiring.

### Non-goals for the first release

- A universal memory of all conversations or automatic ingestion of every run event.
- Autonomous agent-to-agent chat, hidden cross-project knowledge transfer, organization-wide searchable memory or a hosted vector service.
- Training or fine-tuning models. An embedding model only produces numeric representations.
- Replacing Git, task records, the audit log, Skills or existing agent instructions with similarity search.
- Automatic memory approval; semantic similarity is not evidence that a statement is true.

## 2. Existing implementation and compatibility

Verified against the main branch on 2026-10-12:

| Current component                                                                                        | Evidence                                                           | Design consequence                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Modular monolith, per-module data ownership and explicit ports                                           | AGENTS.md, docs/adr/0001-modular-monolith.md                       | Add knowledge module; no direct reads of other modules' tables                                                                  |
| PostgreSQL 17, embedded PGlite, Drizzle SQL migrations, snapshot tests                                   | apps/server/src/platform/db.ts, ADR-0002                           | Must support both engines; no mandatory external vector database                                                                |
| Projects hold local git repo path, branch, worktrees root                                                | apps/server/src/modules/projects/infra/schema.ts                   | Initial indexing belongs to an explicit Project ID; access repo through the projects public API                                 |
| Actor has orgId, principalId, kind, requestId                                                            | apps/server/src/platform/actor.ts                                  | Resolve actor and run scope server-side; never accept caller-supplied org/agent identity                                        |
| RBAC scopes currently include org, agent group and agent, but **not project**                            | apps/server/src/modules/org/domain/rbac.ts                         | Project ACL requires a new capability before multi-user/shared access                                                           |
| Agent execution uses per-run tokens and tools, currently delegation-oriented                             | apps/server/src/http/mcp/tools.ts, apps/server/src/roles/worker.ts | Add retrieval tools through existing run-bound authorization; do not expose an anonymous global search endpoint                 |
| Earlier AgentMemory spec describes 2 KB curated notes, 8 KB prompt injection and proposed human approval | docs/superpowers/specs/2026-10-07-agent-chat-memory.md             | Keep curated instructions separate from search; integrate through adapters later, do not build a conflicting second AgentMemory |
| No memory or conversations module visible under apps/server/src/modules on inspected main                | repository tree                                                    | Treat previous chat/memory spec as specified-only, not shipped functionality                                                    |

**Important compatibility constraint:** the previous AgentMemory design explicitly excludes group/org memory and uses skills for shared instructions. This design does not silently change that decision. Project knowledge is **retrieved reference context**, not inherited instructions, and needs a separate product approval.

## 3. Architecture and trust boundaries

    Source adapters (read only, opt-in)
      project docs / selected repo files / approved decision summaries
                         |
                   discovery + filtering
                         |
                    chunking + hash
                         |
                 embedding provider port
                  /                 \
             local model      external opt-in
                  \                 /
                    Knowledge module
         documents / chunks / embeddings / index jobs
                    PostgreSQL / PGlite
                         |
             authorized hybrid search
                         |
             bounded results with citations
                         |
          authenticated run MCP tool / REST UI
                         |
             Claude Code / Codex / Gemini

Responsibilities:

- **projects** owns what a project is, its repo path and whether the user selected it. Expose a public ProjectLookup/SourceAccess port, not direct SQL table access.
- **knowledge** owns source registry, snapshots, chunks, embeddings, jobs, hybrid retrieval, retention and provenance.
- **org/policy** owns authorization decisions; knowledge calls an injected authorizer and a new project access checker when available.
- **runs/execution** owns run-bound token verification, tool exposure, lifecycle, prompt budget and attribution. It calls knowledge via a port.
- **audit** owns security-relevant action records; use the existing audit port and transactional audit writes.
- **web** provides source setup, index status, search preview and explicit user approval controls.

Knowledge must never be a way to bypass filesystem, role or project access limits. In particular, a file being indexed by an owner does **not** automatically grant an agent permission to retrieve it.

## 4. Source and memory semantics

Three separate concepts:

1. **Source of truth**: git files, approved ADRs, structured tasks and immutable run evidence stay in their owning systems. Never use an embedding as authoritative state.
2. **Knowledge index**: a derived, revocable copy of selected chunks with source path/ref, commit SHA or version, content hash and current/stale state. Search results are citations, not instructions.
3. **Curated AgentMemory** (future integration with the 2026-10-07 spec): short, human-approved fact/preference/instruction entries. Instructions may enter the system prompt only under the already specified capped and recorded mechanism; ordinary retrieved documents do not.

MVP input allowlist: selected repository Markdown/text files, docs directory, ADR files, and human-approved decision summaries. Select include/exclude globs per project; default exclusion includes .git, .env*, credentials, private keys, node_modules, build output, binary files, tool session directories, and secret-looking content. Apply secret scanning/redaction before persistence and again before serving. Never rely only on filename filters. Do not ingest raw chat transcripts, arbitrary web pages or run stdout/stderr by default.

Source objects carry title, kind, origin locator, canonical relative path, source revision, author/trust metadata where available, permission scope, consent version, status and indexing timestamps. Always return source identifiers and stale/permission warnings with every snippet.

Project deletion and disabling indexing should make content immediately unavailable for retrieval; cleanup can run asynchronously. Document the local disk retention of deleted chunks and backups honestly.

## 5. Proposed data model (knowledge module owns all tables)

| Table                    | Main fields / constraints                                                                                                                                            | Why                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| knowledge_sources        | id, org_id, project_id, kind, locator, include/exclude config, enabled, consented_by, consented_at, created_at, updated_at                                           | Explicit opt-in, one source registry  |
| knowledge_documents      | id, org_id, project_id, source_id, stable_key, source_revision, content_hash, status (active/stale/deleted/blocked), title, canonical_path, indexed_at, last_seen_at | Provenance and lifecycle              |
| knowledge_chunks         | id, org_id, project_id, document_id, ordinal, content, text_hash, token_count, metadata_json, status                                                                 | Stable chunk identity and text search |
| knowledge_embeddings     | id, org_id, project_id, chunk_id, model_id, model_version, dimensions, embedding, created_at, unique(chunk_id, model_id, model_version)                              | Rebuildable derived vectors           |
| knowledge_jobs           | id, org_id, project_id, source_id, operation, source_revision, status, attempt, next_attempt_at, error_code, timestamps                                              | Durable, idempotent indexing queue    |
| knowledge_query_evidence | optional, bounded run_id, selected chunk ids + hashes, model ids, source revisions, counts, timestamps, no raw secrets                                               | Explain what context a run used       |

All org-owned rows carry org_id; all project-owned rows carry project_id. There are no foreign keys into tables owned by other modules. Enforce same-module keys, uniqueness on source stable keys and (document, ordinal, hash), and indexes on org_id/project_id/status/source_id.

For the first model choose and pin a **single, versioned embedding dimension**, for example 384, after a quality and packaging evaluation. The SQL vector column can then use vector(384). Never silently mix dimensions or embeddings from different models in one similarity query. A model upgrade uses a new index generation and an atomic cutover after backfill. PGlite and PostgreSQL must use the same schema where possible.

Keep chunks bounded (initial experiment: 400 to 800 tokens with 10 to 15 percent overlap), respecting headings and code blocks. Record line ranges and hashes for citations. Limits are starting points to benchmark, not validated defaults. Content sanitization and truncation happen before embedding.

## 6. pgvector, PGlite and migration plan

**PGlite support is feasible**: current PGlite documentation distributes pgvector as @electric-sql/pglite-pgvector, registered when creating PGlite, then enabled via CREATE EXTENSION. Standard PostgreSQL needs the extension installed in the instance and enabled in its database.

References:

- https://pglite.dev/extensions/
- https://www.npmjs.com/package/@electric-sql/pglite-pgvector
- https://github.com/pgvector/pgvector

Do **not** add unconditional CREATE EXTENSION vector and vector columns to ordinary migrations yet: users with existing PostgreSQL installations lacking pgvector would lose the ability to start the entire control plane. Proposed safe rollout:

1. Keep core Drizzle migrations backward-compatible and feature disabled by default.
2. Implement an explicit capability probe for vector support. In PGlite, register the extension in **every** constructor (disk, in-memory, migrated snapshot and restored snapshot) _before_ vector migrations.
3. Ship an opt-in, committed **knowledge/vector migration set** with an idempotent migration runner and its own schema-version tracking. It runs only after the capability check and explicit enablement. Do not write ad hoc untracked CREATE TABLE on startup.
4. For externally hosted PostgreSQL, document installing pgvector and enabling it using a sufficiently privileged DBA session before enabling the feature. Never silently escalate database privileges.
5. Test a clean opt-in installation and upgrade from current data on PostgreSQL 17 and on both PGlite snapshot and persisted-directory modes. Existing installations without vectors must boot normally.
6. If vector capability is missing, report unavailable/degraded status in UI and API. Do not claim semantic search is running. Lexical-only search is allowed if separately implemented and clearly labeled.

Start with **exact cosine similarity**, filtered by org/project/allowed source. pgvector uses the cosine distance operator <=>. Add B-tree indexes for tenant/project filtering and ordinary PostgreSQL full-text index for keyword matching. For small per-project corpora, exact scan is often sufficient and avoids filtered approximate-search surprises.

After benchmarks, add HNSW for large corpora if latency warrants it. pgvector notes that filters applied to ANN search can reduce results and recall; measure recall at k, candidate count and permitted-scope filtering. Never treat an unfiltered ANN shortlist followed by a permission filter as equivalent to authorized exact retrieval.

## 7. Indexing pipeline

1. Authorized user enables project indexing and selects sources. Persist consent and filters.
2. An index job enumerates allowed files through a read-only projects adapter, canonicalizes paths, rejects symlink escapes and size/type exclusions, and performs a secret scan.
3. Fingerprint source revisions and file content. Skip unchanged content; use content hash + chunker version to avoid duplicate work.
4. Parse Markdown/code into bounded chunks, retaining headings, file path, source ref, line ranges and a content hash.
5. An embedding adapter runs only if configured. Default must not upload content to a third party. Use a local embedding engine only when installed/configured and its model provenance, storage and resource requirements are documented.
6. Persist chunks and embeddings as one versioned generation; atomically publish a successful generation. Failures leave the previous **non-stale and still-authorized** generation available, otherwise return stale/degraded explicitly.
7. Mark removed/changed files stale immediately; purge superseded vectors asynchronously. Ensure index jobs are idempotent, bounded, retryable, observable and safe across multiple workers.

Never hold a database transaction open while calling an external embedding API or doing large filesystem I/O. Jobs use leases and conditional updates. Keep concurrency and byte budgets independent of CLI provider account limits.

Local-only path: optional offline embedding model downloaded or supplied with explicit notice/consent; no surprise network requests. Hosted embeddings are an advanced opt-in setting with clear disclosure that selected text leaves the machine. Account for cost, latency, rate limits and vendor retention terms.

## 8. Retrieval and context construction

MVP query:

    projectId (server-derived or authorized explicit project)
    query: string
    limit: 1..10, default 5
    optional sourceKinds and language
    caller: actor or verified run identity (never trusted from request body)

Retrieval pipeline:

1. Resolve authenticated org, project and if applicable run/task/agent.
2. Check explicit permission to view project _and each source category_; deny by default for ambiguous scopes.
3. Validate and normalize input. Generate query embedding with the same pinned model as the current index generation.
4. Run filtered semantic top-k and filtered lexical top-k over only active, permitted chunks. Combine with reciprocal rank fusion (RRF) initially; tune with offline relevance evaluation.
5. Deduplicate near-identical chunks, group adjacent chunks from one source, cap per-source results and apply hard maximum characters/tokens.
6. Return source label, repository-relative path, revision, line range, hash, retrieval mode, score/rank and stale status. Do not present relevance score as a truth or confidence probability.
7. For run context, enforce total token budget and place retrieved text inside a clearly labeled **untrusted source material** block. Preserve instruction hierarchy. Log selected chunk identifiers and hashes for reproducibility.

The agent may use search as needed during work. The orchestrator can also inject a small preflight context on task start, but only after authorizing the concrete task/project and within a strict token budget. A tool being offered through MCP does not force the model to call it.

Fail closed on authorization errors. If embeddings are unavailable, optionally fall back to authorized lexical search (marked lexical-only) instead of fabricating semantic results.

## 9. API and MCP (proposed contracts)

REST, all under /api/v1 and requiring existing actor resolution:

- POST /projects/:projectId/knowledge/sources : register a permitted source with explicit consent.
- GET /projects/:projectId/knowledge/sources : list sources, permissions, health and status.
- PATCH /projects/:projectId/knowledge/sources/:id : enable/disable/change filters.
- POST /projects/:projectId/knowledge/reindex : schedule idempotent indexing and return job id.
- GET /projects/:projectId/knowledge/jobs/:jobId : status, progress and errors.
- POST /projects/:projectId/knowledge/search : search preview with citations.
- DELETE /projects/:projectId/knowledge/sources/:id : revoke availability now, enqueue deletion.

MCP tools for **verified run-scoped sessions**, using the existing run-token/HTTP pattern and existing provider-specific MCP config wiring:

- knowledge_search({ query, limit? }): server derives org/project from the authenticated run/task. Read-only.
- knowledge_sources({}): optional, list accessible source kinds/status only.
- knowledge_propose({ text, sourceRef?, kind? }): **later only**, writes a proposed memory entry requiring approval per the older AgentMemory design. Do not ship writable memory before its owner and approval workflow exists.

No anonymous, global, cross-project or model-controlled projectId escalation. The current MCP tools are delegation-focused, so add a separate adapter that delegates to knowledge use cases; do not give knowledge direct access to delegation tables. No user-provided origin URLs should be fetched by the MCP tool.

Example result (illustrative, not a current endpoint response):

    {
      "mode": "hybrid",
      "results": [{
        "text": "JWT expires after 15 minutes",
        "source": "docs/adr/0007-auth.md",
        "revision": "9f84...",
        "lines": [20, 26],
        "chunkHash": "sha256:...",
        "stale": false
      }]
    }

## 10. Authorization, security, privacy

- Existing RBAC ResourceRef lacks projectId. Before exposing project retrieval to a multi-user deployment, implement project-scoped authorization or a dedicated ProjectAccess port; access is **deny by default** where membership is unresolved.
- For initial localhost usage, run tokens are scoped to a particular active run. Resolve agent and project from the server's run/task data. A run with no project gets no project retrieval permission.
- External MCP clients (e.g. a user's Claude Code on another machine) require a separately designed, authenticated connection and user-approved project grants. The current localhost-only run-token mechanism is not a general remote OAuth server.
- Restrict sources by project, path, source kind, sensitivity labels and actor grants **inside the DB query**, not just in UI or prompt. Apply authorization at request time even if the embedding was created under broader permissions.
- Treat all ingested snippets as untrusted input. Reject instructions embedded in source files to ignore policies, call tools, reveal credentials, change system prompts or increase permission scopes.
- Do not index .env, tokens, chat auth/session files or raw secrets. Secret scanning must be best-effort plus access control, not a guarantee; disclose residual risk.
- Do not forward source text to external embedding APIs without opt-in. Redact all search terms/content from ordinary access logs, tracing and error reports. Security-sensitive actions and consent changes are audited with hashes/IDs, not entire document bodies.
- Implement source deletion, index purge, model-cache policy, retention controls and a deterministic way to audit which sources were retrieved by each run.
- Local-only deployment remains bound to 127.0.0.1. The hosted/team-mode trust model is a separate decision.

## 11. UI, observability and failure behavior

Add a **Knowledge** section inside Project detail, not a global memory control screen in the MVP:

- Sources table with enabled/disabled, file count, indexed count, last refresh, stale/errors and source-level scope.
- Configure include/exclude patterns and preview excluded files before indexing.
- Index health/capability badge: ready, indexing, disabled, degraded/lexical-only, extension missing.
- Search preview: query, ranked snippets, citation paths/line numbers, model version and search mode.
- Explicit consent for external embedding providers, warnings for secret detection, revoke/reindex controls.

Observe queue depth, documents/chunks indexed, retries, duration and query latency, lexical vs vector mode, stale count, retrieval empty/denied counts and embedding calls/cost. Never emit content or raw embeddings into telemetry.

Failures must not block unrelated task execution. Task preflight either proceeds with clearly disclosed unavailable knowledge (optional retrieval) or stops if the user explicitly marked verified context as required. Under no condition silently inject stale or cross-project content.

## 12. Test and acceptance plan

Unit tests with pure fake embedding adapters and no paid API calls:

- Chunk splitting, stable hashes, idempotence, dimension/model mismatch, ranking/dedup and stale invalidation.
- ACL matrix: same org/different project, different org, agent outside project, disabled source, lost grant after indexing, run without project. Negative tests must prove zero content leakage.
- Prompt injection fixtures: malicious documents cannot change privileges or trusted prompts.
- Secret/filename/path exclusion, symlinks escaping repo root, deletion and reindex races.
- Run-context token cap, provenance hashes recorded, error/lexical fallback marked correctly.

Integration tests:

- PGlite in-memory and persistent directory: vector extension registered for all creation paths and snapshot restoration, capability probe, vector migrations, exact filtered similarity, restart/reindex.
- PostgreSQL 17 with pgvector: extension/bootstrap, migration and upgrade from pre-vector state, search parity and transaction/worker lease races.
- Existing installation **without pgvector** starts and runs existing task board/agents unmodified.
- REST and MCP: token authorization, project narrowing, Zod contracts, audit entries and no accidental cross-module table access.
- With two workers and concurrent reindexes, no duplicate published generation.
- An offline evaluation set of at least 20 project questions with known source citations; compare lexical-only, vector-only and hybrid recall@5, latency and cost.

Acceptance criteria for a first release:

1. Enable knowledge in a clean local PGlite setup, index explicitly selected docs, retrieve relevant snippets with file/line citations.
2. Same design works on PostgreSQL 17 with pgvector.
3. It is off by default; absence of extension or embedding model cannot break the existing product.
4. Unauthorized project/agent never receives text or vectors from another scope, including via MCP.
5. Deleting a source immediately makes it undiscoverable and triggers an auditable purge.
6. All search results identify mode, source revision, embedding model/version and staleness.
7. No background content upload or surprise embedding cost.

## 13. Incremental delivery candidates (not backlog tasks)

| Order | Slice                                                                            | Dependency                                              | Exit criterion                                                   |
| ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 0     | Security/UX decisions, consent semantics and selected corpus                     | Owner approval                                          | Written accepted ADR / scoped MVP                                |
| 1     | Source registry and project-scoped lexical-only search                           | Project source/public ports and actor checks            | Reliable citations, ACL negative tests, no embedding dependency  |
| 2     | Vector capability probe + PGlite/Postgres gated migrations                       | Slice 1; tested extension packaging                     | Both DB engines work; existing installs still boot               |
| 3     | Local embedding adapter, indexing jobs and hybrid search                         | Slice 2                                                 | Offline opt-in indexing, relevance benchmark, freshness/reindex  |
| 4     | Authenticated run MCP read tools and context assembly                            | Slice 3; run-token authorization                        | Claude/Codex runs retrieve only their project; evidence recorded |
| 5     | UI source management/search preview, safe deletion and operability               | Slices 1-4                                              | Complete user flow, capability/error states, audit               |
| Later | AgentMemory proposals, shared/team memory, external OAuth MCP, hosted embeddings | Separate owner decision, user/project ACL and approvals | No implicit privilege widening                                   |

Recommended MVP cut: slices 0-4 with minimal read-only UI. Delay auto-learning from arbitrary runs and federated org memory until verified provenance and permissions are solid.

## 14. Open decisions for architect and owner

1. Default deployment behavior: completely disabled until enabled versus lexical-only local knowledge on by default. Recommended: disabled, user opt-in.
2. Required context for v1: repo docs/ADRs only versus approved task summaries too. Recommended: repo docs/ADRs only.
3. Embedding adapter: specific 384-dimensional local model/package and artifact distribution; benchmark quality with real Agent Band repo, including multilingual queries, before selecting.
4. Remote embeddings: reject for MVP or expose explicit BYOK with consent? Recommended: defer.
5. How project-level grants interact with current org/agent-group/agent RBAC and workDir policy.
6. Whether project knowledge needs cross-agent sharing immediately. Recommended: read-only within authorized project; no org-wide scope.
7. Initial support for Gemini given current code's provider constraints. Design shared MCP contracts now but ship only with verified adapters.
8. Migration strategy ownership: dedicated feature-gated migrations as above versus making pgvector required in a future major release. Recommended: feature-gated.
9. Whether to join the earlier AgentMemory proposal into one UI later. Recommended: distinct Curated Memory and Project Knowledge.

## References

- docs/consultations/README.md and docs/consultations/2026-10-12-gpt-consultation-001.md
- docs/superpowers/specs/2026-10-07-agent-chat-memory.md
- docs/superpowers/specs/2026-10-07-projects-worktrees.md
- AGENTS.md, docs/adr/0001-modular-monolith.md, docs/adr/0002-postgres-pglite-drizzle.md, docs/adr/0003-identity-policy-audit.md
- apps/server/src/platform/db.ts
- apps/server/src/modules/projects/infra/schema.ts
- apps/server/src/modules/org/domain/rbac.ts
- apps/server/src/http/mcp/tools.ts
- apps/server/src/roles/worker.ts
- https://pglite.dev/extensions/
- https://github.com/pgvector/pgvector
