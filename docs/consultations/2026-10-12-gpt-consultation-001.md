# GPT Consultation 001: Product direction and UX

Date: 2026-10-12
Source: Product owner's voice conversation with ChatGPT
Status: Discovery notes, not an approved implementation plan
Audience: Product owner, Claude (architect), and other planning agents

## Purpose

Capture the actual product owner's thinking so future conversations can build on it. Claude should critically review these ideas, compare them with the current implementation and existing specifications, and propose a prioritized backlog or a justified change in direction. **Do not interpret every idea below as a commitment or silently create implementation tasks.**

## Product origin and current workflow (confirmed by the owner)

- Agent Band originally addressed a personal need: several Claude/Codex-style CLI accounts with separate limits, and the friction of switching between them manually.
- Account scheduling, task queuing and running available accounts as limits allow are already useful to the owner. This operational value must not be lost while expanding the product.
- Today the owner often discusses Agent Band development with an external Claude session. Claude breaks the work into tasks and queues them through Agent Band. The owner seldom fills in the manual task creation form.
- That workflow illustrates the opportunity: natural-language interaction is a convenient input interface; Agent Band is the execution, scheduling, accounting and audit engine.
- The bigger aspiration is a coordinated team of AI agents with distinct roles, potentially resembling a small development organization. This is a direction, not a finalized product specification.

## Customers and commercial direction (hypotheses, not validated)

- Potential initial customers: small technical companies with development teams that want greater output without proportional headcount growth.
- The owner wants to develop Agent Band as a paid product, potentially enterprise-capable. They have some Google Ads credit to test acquisition and are interested in the possibility of future investors.
- Avoid unproven promises such as “a full engineering team for the price of one developer.” Test a narrower value proposition: more parallel work, better observability and controlled autonomous execution for small teams.
- Validate who the economic buyer is, which painful workflow warrants payment, onboarding friction, willingness to pay, and retention before large enterprise engineering investments.
- Pricing is open: platform subscription, per agent, per concurrent run, and enterprise licensing were mentioned as possibilities, not decisions.

## Packaging and deployment: keep the options open

The owner sees **three usable interfaces/modes**, not competing products:

1. **Local macOS desktop app**. Click to launch without manually starting a backend or opening localhost. The app could start local API/worker/storage automatically, remain active in the menu bar, notify on completed or blocked work, and provide a clear view of running agents. This also directly serves the owner's daily workflow.
2. **Web interface hosted on a remote server**. Could support team or hosted SaaS usage.
3. **Desktop app connected to a remote backend/server**. Preserve desktop convenience while administering remotely executing teams.

Also consider full enterprise self-hosting and a hosted control plane with customer-run workers (BYO compute). These are architectural/commercial options, **not approved delivery targets**.

Current architecture already has API and worker process roles in a modular monolith. Prefer retaining module boundaries and separately deploying API/workers rather than assuming a microservices rewrite is necessary for Kubernetes. A remotely hosted control plane should **not** require exposing a shared database directly to untrusted customer workers. It needs secure transport, identity, isolation, leases, authorization and reconciliation.

For macOS packaging, evaluate a wrapper such as Electron vs Tauri against Node runtime packaging, CLI discovery, process lifecycle, OS permissions, signing/notarization and background operation. The existing README already lists a macOS desktop direction.

## Model accounts and billing: open commercial decision

Two broad choices were discussed:

- **Bring Your Own Key / account (BYOK)**: customer supplies an authorized provider integration, and buys Agent Band as the orchestration platform. This lowers the platform operator's token-cost exposure and may simplify initial commercial rollout.
- **Managed model usage**: Agent Band supplies API access and meters customer consumption, charging a subscription and/or usage markup. This improves onboarding but brings metering, cost exposure, rate-limit, fraud, billing and vendor-contract concerns.
- A **hybrid** offering may ultimately make sense: BYOK first, managed API usage later, if demand warrants it.
- Clearly distinguish authorized API usage from consumer CLI subscriptions and their credentials. **Do not assume a provider's consumer plan can be resold or redistributed.** Verify each provider's current applicable commercial terms before designing or marketing this feature.
- The existing CLI-account switching functionality remains a distinct local product value; preserve it even if an enterprise API-based offer develops.

## Primary UX problem: complexity and configuration burden

The present UI mirrors powerful internal concepts (accounts, agents, groups, skills, policies, tasks, schedules). That creates setup and navigation friction for new users. The owner specifically finds it hard to specify detailed prompts/tasks from scratch and anticipates substantial overhead in granting different agents access to different repositories/systems.

Guiding principle: **simple task intent at the surface, explicit controls and audit underneath**. Do not remove advanced functionality; progressively disclose it.

### Conversational task creation: the central requested UX

This must **not** be conflated with talking specifically to a “leader” agent or with a general chatbot replacing every screen.

- In **New Task**, offer a conventional form **and** “Create through conversation.”
- The user speaks or types a loosely specified problem or goal.
- The conversational engine loads the selected project's existing context: repo(s), known architecture/stack, infrastructure, existing work and relevant policies. It should not ask for facts it can reliably retrieve, and should not invent project context.
- It asks focused follow-up questions where genuinely necessary, investigates authorized resources if appropriate, and turns the conversation into a structured proposal: a single task, several independent tasks, or a parent goal with subtasks and dependencies.
- Present the proposed plan, assignees (if applicable), key assumptions, constraints, risk and resource/usage considerations. The owner can discuss changes and iterate.
- **No tasks run automatically.** User approval commits the final proposal to the existing draft/goal/task flow. Execution is a separate explicit step or permissioned action.
- Support basic text first; optional speech-to-text, then full two-way voice conversation. Dictation alone is not the same as interactive conversation.
- Consider the name **Task Composer** for this engine, but the name is provisional.
- The engine need not itself be the leader execution agent. It should generate validated task structures consumed by existing backend APIs.
- Keep a conversation attached to its project/proposal so an interrupted session can resume with the same context and intent.

A broader, ongoing agent/leader chat to inspect progress or manage work could be valuable, but is **separate from** this task-creation entry point.

### Project context as the key dependency

- Make project context trustworthy, scoped and explainable: connected repositories, architecture, workspaces, history, current status, and permissions.
- Decide what is indexed or cached, how updates are synchronized, what user consent is needed, and how a model cites the source of its understanding.
- Explicitly handle missing, stale or inaccessible data. Retrieval of secrets is not acceptable project “context.”
- Provide a clear project selector or implicit current project context before starting a conversational task.

## Configuration, permissions and audit

The owner wants powerful per-agent access controls and audit, but worries that configuring each agent's access to multiple repositories/services will create too much work.

Potential simplification:

- Attach resources and trust boundaries to **projects**.
- Offer **role-based permission templates/presets** such as developer, QA, DevOps, reviewer, leader. Propose defaults, allow explicit customization and inheritance.
- Support the possibility of granting narrowly scoped, short-lived access for a specific task, only with the appropriate human approval and automatic revocation.
- Provide guided, possibly conversational configuration: “add two backend agents to project X with write access to repository Y but no production deploy or main-branch merge.”
- Preserve precise audit of requested permission, approved scope, actor, time, action and expiry.
- Critical: application-level policy is not an OS/container security boundary. The effective rights of the spawned CLI, filesystem credentials, shell commands, GitHub tokens and network access must actually enforce restrictions. Evaluate provider-specific gaps and use least-privilege tokens, isolation and human approval for sensitive operations.
- A “full access” agent may be a consciously permitted exception, not the insecure default.
- Existing policy hierarchy and provider coverage reporting are a starting point; project-aware RBAC, resource-scoped credentials and time-bounded elevation are **proposals**, not verified complete features.

## Current implementation references to inspect

Before claiming anything is missing or finished, Claude should check current code and the following files (which may have evolved):

- `README.md`, `AGENTS.md`, `docs/backlog.md`.
- `docs/superpowers/specs/2026-10-06-agent-band-design.md`.
- `docs/superpowers/specs/2026-10-07-agent-chat-memory.md`.
- `docs/superpowers/specs/2026-10-07-approvals-conversation.md`.
- `docs/superpowers/specs/2026-10-07-planning-mode.md`.
- `docs/superpowers/specs/2026-10-07-projects-worktrees.md`.
- `docs/superpowers/specs/2026-10-07-stage3-leader.md`.
- `docs/research/cli-capability-matrix.md` and `docs/api-gaps.md`.
- Actual modules in `apps/server/src/modules/`, `apps/server/src/roles/`, `apps/server/src/runner/` and `apps/web/src/screens/`.

At consultation time, GitHub showed code for delegation/orchestration and task planning. The chat/memory conversation specifications exist, but **the existence of a spec is not proof that its functionality has shipped**. Audit current implementation and tests.

## Suggested priorities for Claude to assess (not assigned tasks)

1. **Protect the existing core**: account switching, scheduling, limits, queues, local reliability.
2. **Map current user journey and friction**: quick user-flow audit for adding a project/account/agent/task, with onboarding and “what's happening” visibility.
3. **Conversational Task Composer MVP**: text input, project-context retrieval, focused questions, structured proposal, edit/revise, explicit approval, creation of drafts through existing API.
4. **Project context model**: define minimal reliable context, supported sources, refresh semantics and safe boundaries. Reuse existing projects/worktrees.
5. **Safe configuration presets**: role/project scoping, clear effective permissions, human-approved exceptions, credible runtime enforcement and audit.
6. **Desktop convenience MVP**: package the current app locally with automatic process startup/shutdown, menu bar and status visibility. Compare against the UX benefit of Task Composer rather than assuming an order.
7. **Deployment/product validation**: interview target buyers, test the initial promise and pricing, and compare hosted control plane with customer-run workers versus full SaaS/self-host.
8. **Managed API billing (later)**: only after demand and provider terms are established.

Claude should propose small, testable increments, identify dependencies and risks, and avoid building extensive enterprise infrastructure before product-market validation.

## Questions and explicit requests for Claude (architect)

Please read this consultation, then:

1. **Summarize the actual product direction** in your own words, emphasizing the owner's concrete pain points rather than treating brainstorm ideas as fixed decisions.
2. **Compare the ideas with current code and specs.** Mark each as implemented, partly implemented, specified only, or absent, with paths as evidence.
3. **Recommend a short, ordered list of candidate tasks**, with value, scope, dependencies, key acceptance criteria and rough effort. Avoid duplicating existing work.
4. **Challenge the direction where warranted.** If a simpler product strategy or sequencing would create more user value, explain why and recommend it.
5. Explicitly flag high-risk gaps in auth, isolation, credentials, hosted workers and provider billing terms.
6. Keep the architecture modular and plan for local macOS, remote web and desktop-to-server modes without implementing all deployment modes immediately.
7. Distinguish **agreed needs**, **working hypotheses**, **proposals** and **open decisions**. Do not unilaterally change the roadmap or generate/execute tasks from this note without the owner's approval.

## Open decisions

- Initial customer and what the buyer is paying to solve.
- First paid offer and pricing unit.
- BYOK-only at launch versus hybrid with managed API.
- macOS desktop-first versus conversational task creation-first for the next measurable MVP.
- Local-only versus hybrid-hosted versus self-hosted enterprise as the initial delivery mode.
- Required project-context sources, their isolation and refresh guarantees.
- Exact limits of project and role templates, runtime sandboxing, and approval semantics.
- Whether ongoing leader chat becomes the central navigation paradigm (owner has **not** requested that; the specific ask is conversation-assisted task creation).

## Consultation record policy

Future entries belong under `docs/consultations/` as dated, numbered Markdown notes. Capture the owner's words and decisions carefully. Label hypotheses distinctly from commitments, link follow-up decisions or tasks, and do not overwrite the previous consultation's history.

## Follow-up: voice conversation and delegated reasoning

Date: 2026-10-12
Status: Further product discussion and architecture candidate, **not an approved task**

### Owner's goal

The owner especially values a **natural, real-time spoken conversation** with fluid turn-taking, expressive delivery, short acknowledgments and interruption handling, similar to their experience in ChatGPT Voice. They want to offer a comparably smooth interaction in Agent Band, while retaining Claude's coding/project reasoning capability.

The new explicit design question: **Can Claude do the thinking and GPT do the talking?** The answer is yes in principle. Keep the voice/dialogue engine distinct from the planner/reasoning/execution engine.

### Current provider capability assessment (12 October 2026)

- Anthropic's **Claude consumer voice mode exists** on Claude Mobile, Claude Desktop and claude.ai (beta), with hands-free turn-taking, push-to-talk, interruption handling, voice choices and multilingual input/conversation. It supports text/voice continuity and certain connected tools. It is not correct to claim Claude lacks voice conversations.
- Anthropic's consumer Claude voice mode is **not equivalent to an embeddable voice API** for Agent Band. The Claude Platform API documentation confirms text-based Messages API and related interfaces. As of this consultation, we did not verify an officially exposed Claude-native full-duplex speech-to-speech API suitable for integrating the *same* Claude Voice experience inside a separate product. Confirm again before implementation.
- Anthropic docs say voice mode is not available directly in **Claude Code or Cowork** (dictation is available).
- OpenAI's **GPT-Live** documentation explicitly supports a real-time audio frontend that delegates reasoning/tool use to a separate backend. **Client delegation** can call an arbitrary provider/model/agent controlled by Agent Band, including Claude.
- An alternative is **ElevenLabs Speech Engine** for speech-to-text, text-to-speech and interruption management, while Agent Band uses Claude as the LLM. Evaluate quality/latency/cost in prototypes, not by assumption.

Sources:
- Claude Voice: https://support.claude.com/en/articles/11101966-use-voice-mode
- Claude API overview: https://platform.claude.com/docs/en/api/overview
- Claude OpenAI SDK compatibility / audio limitations: https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
- OpenAI GPT-Live delegation: https://developers.openai.com/api/docs/guides/live-delegation
- OpenAI voice agent architecture options: https://developers.openai.com/api/docs/guides/voice-agents
- ElevenLabs Speech Engine: https://elevenlabs.io/docs/overview/capabilities/speech-engine

### Proposed implementation concept

A single conversation in the Agent Band macOS app or web UI:

1. The user selects a project and starts a voice conversation (or switches to text).
2. GPT-Live manages microphone/speaker interaction, speech timing, interruptions, clarifying questions and concise spoken explanations. Its role is a **voice interface**, not an authority that executes unapproved changes.
3. Agent Band owns the canonical conversation/transcript, project context, authorization and proposal state. When analysis is needed, it delegates the relevant turn to **Claude via an authorized adapter** (Claude API or Claude Code, as appropriate) while attaching controlled, relevant project context.
4. Claude reasons about the problem, examines authorized code/resources if needed, asks targeted follow-up questions via structured results, and drafts task plans/structured proposals.
5. Agent Band validates Claude's response against its task/goal schemas. GPT presents the result conversationally; the UI displays the **actual draft proposal**, not an untracked spoken promise.
6. The user changes or approves the plan. **Only backend-confirmed approval** commits draft tasks or starts execution. Spoken consent should not bypass the product's explicit approval requirement; use the designated confirmation flow.
7. Users may interrupt, switch to text, or resume later; conversation turns, delegation IDs, proposal revisions, approval decisions and completed operations remain linked.

Illustrative flow:

`User speech -> GPT-Live -> Agent Band delegation bridge -> Claude + authorized project context -> validated plan/proposal -> GPT-Live spoken reply + UI preview -> user approval -> existing Task/Goal API`

**Avoid routing every “yes,” “no,” or conversational acknowledgment through expensive Claude reasoning.** GPT-Live can manage short social turns; delegate for project-specific analysis, tool actions, structured task proposals or decisions that require external context. Conversely, the voice layer must not fabricate results or modify the plan on its own without synchronizing canonical state.

### Technical and product risks to evaluate

- **Latency:** delegate only when needed; stream useful progress where safe. Two models/providers can introduce noticeable pauses. Benchmark full task conversations, not just time-to-first-token.
- **Session continuity:** distinguish speech turn IDs, Claude session/thread IDs, task proposal revision IDs and execution run IDs. Discard stale answers and deduplicate after reconnects.
- **Interruptions and confirmations:** stopping playback is not canceling an operation already sent to Claude. The backend must track and explicitly handle cancellation.
- **Trust boundaries:** project source and transcripts may pass through *both* providers. Offer clear data disclosures and enterprise BYOK/provider selection; never forward unrelated files, credentials or entire repos unnecessarily.
- **Provider integration:** Claude consumer voice subscriptions should not be assumed to provide voice API access. Separately review commercial permissions and costs for using Claude API, CLI accounts and GPT-Live API.
- **Role clarity:** GPT is not necessarily the planner/leader. Claude can be the delegated reasoning agent; the existing execution framework remains separate.
- **Accessibility and fallback:** voice is optional; the same Task Composer should function fully through text.

### Request for Claude (architect)

Review this follow-up alongside the rest of Consultation 001. Verify current API and voice capabilities when designing. Propose a narrow proof of concept comparing (a) **GPT-Live client delegation -> Agent Band -> Claude**, (b) a modular STT -> Claude -> TTS pipeline, and optionally (c) ElevenLabs Speech Engine -> Claude. Evaluate perceived naturalness, interruption behavior, accuracy of intent, latency, cost, privacy and integration complexity. Recommend a staged rollout with text Task Composer as the stable fallback. **Do not create implementation tasks or treat a vendor choice as final without owner approval.**

## Follow-up: visual agent and task workflows

Date: 2026-10-12
Status: Owner-requested product capability for exploration, **not an approved implementation task**

### User need

The owner would like an optional **diagram / block-based visual editor** for configuring agents and expressing how a task should flow between them. Users should be able to assemble “blocks,” connect them, and see who talks to whom, who does which step, and how the result proceeds to the next agent.

This is especially relevant when creating a task: instead of writing a complex prompt or manually configuring every agent interaction, the owner imagines showing the workflow visually. It complements, rather than replaces, the conversational Task Composer and the existing task form.

### Distinguish two related surfaces

1. **Reusable team/workflow templates**: configure a project team or reusable pattern of interaction (e.g. developer -> reviewer -> QA) using agent or role nodes, connections and default constraints. Reuse across tasks.
2. **Task-specific execution graph**: during task creation, show the particular steps, assignees, dependencies, potential parallelism, reviews and approvals. The user can modify it before submitting.

Agent *identity and long-lived permissions* should stay separate from task *workflow* and temporary scope. A line drawn between two blocks is a delegation/dependency/data-flow configuration, **not an implicit grant of access**.

### Example user journey

- In New Task, choose “Create with conversation” or “Visual workflow,” with the existing form as a fallback.
- Conversational Task Composer analyzes the authorized project context and produces **a structured draft plan and a visual graph from the same canonical data**.
- Example: `Feature request -> Backend agent + Frontend agent (parallel) -> Reviewer -> QA -> Human approval -> Merge/deploy`.
- The user moves nodes, assigns roles/agents, adjusts dependencies or adds an approval gate, then sees the underlying task definitions update. Alternatively, they speak: “QA should run after code review,” and the graph updates.
- Agent Band validates the graph and policy before saving draft tasks. Execution requires appropriate user confirmation, and the board shows actual status on the graph as work proceeds.
- For monitoring, nodes indicate queued/running/blocked/done/failed; selecting a node opens that task's run log, costs, decisions and audit trail.

### MVP scope to evaluate

- Start with a **read-only graph of existing parent/child tasks and `dependsOn` dependencies** for a goal, showing status and assigned agent.
- Next, allow lightweight plan editing before approval: task nodes, agent/role picker, dependency edges, parallel branches and a human-approval node where existing mechanisms support it.
- For reusable workflows, add templates after real usage demonstrates repeatability. Only later consider conditions, retries, failure branches, loops or richer artifact handoff.
- Persist a versioned, typed graph/proposal that maps to the existing task/goal/delegation APIs; do not build a second, contradictory execution engine or permit arbitrary graph code.
- Design explicit semantics for edge types: task ordering versus data/artifact handoff versus escalation/review; avoid a UI where all lines appear equivalent.
- Enforce cycle detection on DAG dependencies, reference/permission validation, agent availability, budget and concurrency checks. Show policy conflicts instead of silently widening privileges.
- Keep the visual editor optional: complex graphs may overwhelm beginners; offer templates and progressive disclosure.

### Request for Claude (architect)

Compare this idea with current task trees, `dependsOn`, goal orchestration, planning/review UI and project/agent policy models. Identify what can be visualized directly now versus what would require new schema, APIs or scheduler semantics. Propose a phased UX and technical approach, e.g. React Flow / XYFlow **as an implementation candidate, not a technology mandate**. Define a simple node/edge schema, source-of-truth and sync behavior between natural language, form and graph; address policy enforcement and traceable approvals. Provide prioritized candidate tasks and acceptance criteria, **without automatically creating tickets or changing the roadmap**.

## Follow-up: cost-aware model delegation and configurable code review

Date: 2026-10-12
Status: Owner preference and product configuration candidate, **not an approved implementation task**

### Discussion and intent

The owner has limited access to high-capability model usage and does not want routine software development to consume expensive tokens unnecessarily. The owner also correctly points out that **code review may deserve a stronger model than implementation**: a capable reviewer can detect consequential mistakes in code written by a less expensive worker. The aim is to optimize quality per unit of cost, **not** always select the cheapest model.

### Distinguish existing implementation from additional capabilities

Verified in the `main` source during this consultation:

- Agents have individually configured models and provider accounts. The model is passed into the worker runner: `apps/server/src/modules/agents/app/agents.ts`, `apps/server/src/roles/worker.ts`, `apps/server/src/runner/models.ts`.
- The leader can discover eligible agents and their configured models, then delegate subtasks or request reviews through the existing MCP workflow: `apps/server/src/modules/delegation/app/delegation.ts` and `apps/server/src/roles/leader-prompt.ts`.
- Existing controls include per-account daily token/cost budgets, per-goal token budgets and limits on rounds/subtasks, plus policy-dependent account failover: `apps/server/src/modules/usage/app/usage.ts`, `apps/server/src/modules/delegation/app/orchestrator.ts`, `apps/server/src/roles/worker.ts`.

**Not verified as an implemented feature:** a deterministic, cost-aware model-selection policy that classifies task complexity and picks a minimum-sufficient model automatically, or a configurable per-task versus final-PR review schedule. The leader's ability to choose a configured agent is not the same as guaranteed automated cost optimization.

### Proposed configurable strategy

- **Planning / architecture:** use a more capable model when complexity or risk warrants it.
- **Implementation:** delegate straightforward, well-scoped work to lower-cost agents; use intermediate/capable models for standard or challenging implementation. Prefer measured suitability over fixed model names.
- **Code review:** allow a stronger model than the implementation model. The reviewer returns actionable findings to the implementation agent, rather than rewriting everything by default.
- **Review frequency (user-configurable, not hardcoded):**
  - `final_pr_only` — **suggested default to evaluate**, one strong review after subtasks are integrated into a final PR; lower token consumption.
  - `each_subtask` — a review after every completed subtask, for high-assurance or tightly coupled work.
  - `risk_based` — optional future strategy: review high-risk or complex subtasks early, then review the final integration.
  - `none` — where allowed by project policies; do not remove required approval or security gates.
- Configure the strategy per project / workflow / goal, with explicit overrides where appropriate. Surface the selected reviewer role/model, review trigger, budget and estimated impact before execution.
- For each review, initially supply requirements, diff/changed files, relevant test results and targeted context; let the reviewer retrieve more repository context when needed. Large reviews are **not guaranteed to be cheap**.
- Cap review iterations and spending; enforce approved access controls, auditable decisions and explicit human approval where policy requires it. A failed or unavailable strong reviewer should not silently waive a required review.

### Request for Claude (architect)

Inspect current delegation, review creation, leader continuation, account routing, per-agent model configuration and policy enforcement. Identify which review-frequency choices already exist and which would need additional configuration or scheduler behavior. Recommend the smallest implementation increment, potentially beginning with leader guidance and reusable reviewer-agent presets, before proposing a new automatic model router. Propose configuration scope, acceptance criteria, token/cost measurement, quality evaluation and a rollback path. **Do not create tasks or modify the roadmap without the owner's approval.**
