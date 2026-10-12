# GPT Consultation 002: External Git Agents (ChatGPT text sessions)

Date: 2026-10-12
Source: Product owner's voice conversation with ChatGPT
Status: Product discovery and proposed architecture; **not an approved implementation task**
Audience: Owner, Claude (architect), and Agent Band implementers
Related: [Consultation 001](2026-10-12-gpt-consultation-001.md); existing handoff/chatgpt protocol

## Core user intent

Introduce **External Git Agent** as a special Agent Band agent type whose runtime is an ordinary, manually opened ChatGPT text conversation with GitHub access, rather than a process spawned by the Agent Band worker. The owner wants to use several normal ChatGPT windows as different development agents (developer, QA, reviewer, etc.), optionally handling many queued tasks during one conversation.

**Crucial distinction:** Agent Band provisions the agent and its full identity, instructions, scope, tasks, and project context **before** the conversation begins. The human should only need to say something short, e.g.:

> You are agent A in xobox123/agent-band. Read your configuration from the repository and continue your assigned work.

The owner does **not** want to re-explain "you are a backend developer", repeat the complete prompt or manually enumerate the next task on every chat. A replacement conversation should be able to resume the same agent from durable repository state.

The owner is comfortable with a **manual trigger**: open one or more chats, send the minimal bootstrap command, and let each chat continue through its assigned queue as far as the session and connected tools permit. Agent Band cannot directly awaken or message those consumer ChatGPT windows and must not pretend otherwise.

## GitHub as the coordination boundary

- The GitHub repository is the **shared durable coordination surface** for this integration: agent profiles, assignments, lifecycle records, task reports, branches, PRs, and evidence of checks.
- An Agent Band database may index or cache this state for UI and scheduling, but must reconcile it against canonical GitHub records. Avoid two independently writable sources of truth.
- Completion is **explicitly reported**. Agent Band must not infer "done" merely because a code file changed or a commit exists.
- Use issue/PR metadata, structured files, or both as deliberately chosen protocol records. Define one canonical location and conflict-resolution rule per item, including on which branch it lives.
- This is a GitHub-backed **external worker adapter**, not a full replacement for the existing API/worker execution architecture or an actual ChatGPT API connector.

## Desired configuration UI in Agent Band

Proposed user journey:

1. Add Agent > choose "External Git Agent" (ChatGPT as initial runtime/profile; keep protocol provider-agnostic).
2. Give it a persistent ID, human-readable name, role (Backend Developer / Frontend Developer / QA / Reviewer / custom), project(s), repository, operating instructions, capabilities, reviewer requirements and GitHub permission scope.
3. Assign a queue or allow task routing to this agent; optionally set concurrency, branch policy, maximum tasks per session and review/CI gates.
4. Agent Band **provisions versioned files** in a known repository path and presents a **copyable one-line bootstrap command**.
5. Open an ordinary ChatGPT text chat and paste the bootstrap command. The chat reads the provisioning manifest, agent instructions, queue and current status from GitHub; it works through eligible tasks, creates task branches and PRs, and reports results.
6. Agent Band shows the registered external agent and synchronizes assigned / active / reported / validated / blocked work from GitHub. It should also show "last reported activity"; it cannot reliably observe whether a consumer chat window is presently open.
7. If a session is interrupted or runs out of context or access, open a new chat and use the same agent ID. The new conversation resumes from persisted state, not previous private chat context.

Example **illustrative** layout (not prescribed schema):

    .agent-band/
      protocol.md
      agents/
        agent-a/
          manifest.yaml
          instructions.md
          state.json
          tasks/
            task-123.md
          reports/
            task-123.json

Exact folders, GitHub Issues versus files, and branch strategy must be chosen by Claude after checking current repository conventions; do not duplicate databases or task boards without a migration plan.

## Agent responsibilities and task lifecycle

Proposed per-task flow:

- **Assigned / queued:** Agent Band (or the authorized task owner) assigns a stable task ID and scope.
- **Claimed / in_progress:** ChatGPT reads eligible work and emits an explicit claim with agent identity, task ID, timestamps, correlation IDs and task/branch references. A duplicate worker should not claim the same task.
- **Work:** Create a **task-specific branch** (preferred over one long-lived branch per agent to avoid cross-task pollution), perform only permitted changes, and record progress/checkpoints as needed.
- **Submitted / in_review:** Push changes, open a PR to the intended base branch, produce a structured task report containing what was implemented, what remains, affected files, tests run, CI URLs/status if known, PR URL, caveats and blockers. The report is evidence, not proof.
- **Verified / done:** Agent Band reconciles the report and PR with required CI checks, review and branch/merge policy before marking the task completed. A truthful agent "implementation complete" report may still mean awaiting CI or review.
- **Blocked / partial / failed:** Report the reason and resumable next action. Do not mark complete because of an incomplete implementation.
- **Continue:** If more eligible tasks remain and tool/session limits allow, claim the next task; otherwise stop and report that a manual resume is needed.

Suggested machine-readable fields (candidate only): protocol_version, agent_id, task_id, state, claim_id, claimed_at, updated_at, branch, commit_sha, pr_url, report_url, tests, ci_status, summary, pending_work, blocker, next_action. Protect immutable task IDs and task-owner-controlled fields from unauthorized worker edits.

### Coordination and consistency risks

- Prefer a single task claim authority backed by atomic conditional updates (e.g. compare-and-swap against a Git ref/version, a protected assignment record, or a GitHub Issue/PR operation with explicit ownership). Writing an unprotected shared STATUS file from multiple chat windows is vulnerable to races and conflicts.
- Clearly differentiate **owner/Agent Band writes** (task assignments, permission changes, final acceptance) from **external agent writes** (claims, reports, commits, PRs). Do not let an agent self-approve its deliverable.
- Claims may be abandoned when a browser/chat disappears. Model lease expiry and human/authorized recovery; do not assume an active ChatGPT process sends heartbeats.
- A branch per task plus a stable agent identity makes many tasks and resumed sessions easier to audit. Decide how parallel agents coordinate shared files and integration order.
- Reports should refer to actual commits/PRs/checks; ingestion must validate schema, repository allowlists, actor permissions and provenance. Treat model-authored completion claims as **untrusted assertions pending independent verification**.
- Credential and repository access restrictions are enforced by GitHub token/app permissions, branch protections and human review, not by prose instructions or a local file alone.
- Protect against prompt injection in repository documents and task descriptions; loading a file must not silently grant more authority to a chat.
- GitHub synchronization may use webhook notifications where possible and reconciliation polling for eventual consistency. Display stale-data/error states honestly.

## Build on the existing handoff, not beside it

An initial handwritten protocol already exists:

- handoff/chatgpt/README.md: owner triggers "bierz zadanie", Claude supplies work in inbox files, ChatGPT returns reports and opens a task branch/PR.
- handoff/chatgpt/STATUS.md: task board owned by the architect rather than written by the ChatGPT worker.
- handoff/chatgpt/inbox and handoff/chatgpt/reports: existing human-readable task and report records.

Treat this as a functioning **manual proof of concept**, not a finished generic external-agent provisioning feature. Claude should decide how to preserve compatibility, evolve the format, and avoid silently moving existing tasks.

## Practical platform limitations (important)

- An ordinary ChatGPT conversation **cannot be remotely triggered or kept executing indefinitely** by Agent Band through repository files alone. It needs a user-initiated message and supported GitHub tool access; longer queues may require another manual turn or a new conversation.
- Standard chat messages, tool executions, connected GitHub access, context length and account usage all have product- and plan-dependent limits. **Do not describe normal ChatGPT coding or GitHub tools as guaranteed unlimited**, or promise that 20/100 tasks can be completed in one invocation.
- Ability to edit files, view Actions, trigger workflows, run tests locally or inspect checks depends on available tools and repository permissions. The GitHub CI pipeline can run its own checks on PR creation/push; avoid implying that local tests ran without a runner.
- Subscription-based chat tools are not an API backend that Agent Band can resell or programmatically automate by imitation. A fully automatic future product would require supported provider integrations, appropriate terms and separate cost accounting.
- Do not store personal credentials, API keys or consumer session cookies in Git.

## Suggested low-risk MVP (for architectural assessment, not implementation authorization)

1. Define a **versioned protocol v0** with a manifest template, per-agent provisioning, task ownership, reports and status transitions, using the existing handoff as input.
2. Add UI registration/configuration plus the short, copyable bootstrap instruction, without trying to automate the ChatGPT UI.
3. Implement robust read-only sync/dashboard of reports, branches, PRs and check status, clearly separating a worker's report from accepted completion.
4. Add safe assignment/claim reconciliation and resumable workflow; support multiple external agents only after conflict-handling tests.
5. Expand to other human-started tools, and optionally later to real provider APIs/runner workers, once the contract has been proven.

## Questions for Claude (architect)

- Compare this idea with existing agent/group/task schemas, worker dispatch, GitHub/project integration, policies and handoff protocol. What is reusable now, specified only, or genuinely missing?
- Define the smallest agent manifest, claim record, report schema and accepted status machine; where should the authoritative records live (file, issue, PR)?
- Recommend safe GitHub permissions and anti-duplication semantics, especially with multiple concurrently opened chats.
- Show how Agent Band can display and manage an external Git agent's lifecycle without claiming direct control of consumer ChatGPT sessions.
- Propose a lightweight UI design for creating the agent and copying its bootstrap command.
- Provide phased candidate backlog work with dependencies, acceptance tests, migration/compatibility, and risk assessment.
- **Do not automatically create implementation tasks, change the roadmap, or claim ChatGPT sessions are autonomous.** Seek owner approval first.
