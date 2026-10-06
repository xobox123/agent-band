# Stage 1 UI screen specification

Language: English. Source of truth: [current stage 1 design](../superpowers/specs/2026-10-06-agent-band-design.md). Scope: localhost control plane, without scheduling, automatic resume, remote runners or working API adapters.

## 1. Contract and shared conventions

Paths below are domain field paths, not promises about an existing HTTP response shape. Relationship joins and aggregates must be served by resource use cases or UI view models, never direct cross-module table access. Prefix `vm.` marks a derived display field. This document defines UI behavior; additions requiring architect approval are listed in section 12.

All stage 1 UI mutations are attributed to `user:local`, the default organization's single local owner. Every use case still calls authorize(actor, action, resource). In multi-user deployments resolve the actual principal rather than hardcoding this handle. Never expose Account.secret or encrypted secret values. All lists, joins, selections and imports are org-scoped; cross-org IDs are rejected. Shared zod contracts define concrete request/response formats. Section 9A defines human access controls; the UI consumes capabilities but never substitutes for server authorization. Provider limits cannot be bypassed. Policy versions and audit records are immutable.

- Timestamps: store UTC, display browser-local date/time with timezone; hover and details expose ISO UTC. Duration: seconds below one minute, then minutes/seconds, then hours/minutes.
- Tokens: exact integer with thousands separators in details; compact count in cards. Unknown is “Unknown”, never zero. USD: up to six decimals, omit unavailable cost from totals and disclose missing coverage.
- IDs: short display with full value and Copy in details. Keys and handles are never truncated without a tooltip.
- Tables: 32 px rows, 36 px column headers, 12 px horizontal padding. Sticky header; single selected row; Enter opens details. Default 50 rows per page with 25/50/100 options for ordinary lists. Audit uses cursor pagination, not page numbers.
- Sort: one column at a time, ascending/descending toggle, deterministic ID tie-breaker. Derived sortable fields require backend support; do not sort only the current page. If unsupported, remove their sort control.
- Text search: trim input, debounce 250 ms, case-insensitive substring of each screen's documented fields. Filters combine with AND; selections within a multi-select combine with OR. Persist screen/filter/sort/selection in URL; do not put secrets or prompts in URLs.
- Buttons: primary creation action first, disabled while pending. Inline field errors retain input. Success closes the form and selects the saved record. RFC 9457 errors display a safe detail, stable code and request ID if supplied. Never show process credentials or raw stacks.
- A stale entity mutation must refresh state and say “This item changed. Review its latest state and try again.” Prevent double submission. Keep cancellation separate from deleting resources.
- Read-only entities have no editable fields. Missing related entities render “Deleted agent/account/policy” plus the retained ID; historical records remain inspectable.
- Dialogs trap focus and return focus to their trigger. Details are non-modal. Every status has a text label; dots are supplementary. Controls have accessible names, visible focus and keyboard equivalents.
- Initial loading: skeleton rows/cards, no empty-state flash. On failed initial fetch show screen-specific error and Retry. Failed refresh retains last good data with “Showing saved data. Refresh failed.” plus timestamp. Zero results after filters: “No matches. Clear filters to see all items.”

## 2. Global layout

Minimum supported viewport: 1024 px wide and 640 px high. Below this show “This workspace requires a window at least 1024 px wide.” Keep the application inside a horizontally scrollable 1024 px canvas; do not hide actions or compress fields below their limits.

| Area             | Size                                              | Content and behavior                                                                                                                                                                             |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Icon rail        | 48 px fixed                                       | Workspace icon (Board), execution icon (Agents/Agent groups/Tasks/Runs), governance icon (Skills/Policies/Accounts/People and teams/Audit); each selects its sidebar group, with tooltip                                    |
| Resource sidebar | 208 px default; 180–280 px resize                 | Workspace: Board, Dashboard. Execution: Agents, Agent groups, Tasks, Runs. Governance: Skills, Policies, Accounts, People and teams, Audit. All groups expanded initially, current item highlighted. Footer: user:local and theme toggle |
| Header           | 48 px high                                        | Screen title, item count, connection state, optional selected resource breadcrumb                                                                                                                |
| Toolbar          | 44 px minimum                                     | Primary action, search and filters; wrap to additional 36 px rows when necessary                                                                                                                 |
| Main             | Remaining width and height                        | Board, dashboard or resource table; independent scrolling                                                                                                                                        |
| Details          | 420 px default; 360–640 px resize                 | Heading, ID/key, Close; scrollable sections; sticky action footer; overlays main at widths below 1440 px, otherwise consumes width                                                               |
| Bottom dock      | 240 px default; 120 px to 60% of workspace height | Selected run log, run selector, stream state, Follow, Clear view, Copy visible text; resizable; hidden until a run log is requested                                                              |

At 1024–1279 px the sidebar defaults to 180 px and may collapse to 0 px via a rail toggle. Main tables scroll horizontally; never drop identity, status or primary actions. At 1280 px and above use the default sidebar. Details overlay must not cover the rail or sidebar. Dock spans the main area including the details region, excludes rail/sidebar, and leaves at least 180 px for main content. Escape closes a form first, otherwise details, otherwise dock.

Layout wireframe expressed as a rendered table:

| 48 px rail | 208 px sidebar                        | Flexible main                          | Optional 420 px details   |
| ---------- | ------------------------------------- | -------------------------------------- | ------------------------- |
| Workspace  | Workspace / Execution / Governance    | Header, 48 px                          | Selected resource heading |
| Execution  | Board, Dashboard, Agents, Agent groups, Tasks, Runs | Toolbar, 44 px+                        | Scrollable sections       |
| Governance | Skills, Policies, Accounts, People and teams, Audit | Board/table/dashboard                  | Contextual actions        |
|            | User and theme                        | Bottom dock, spanning main and details | Bottom dock               |

Theme: dark default, light selectable; persist locally. Use existing design tokens for surfaces and typography. This specification adds no palette beyond status tokens.

Dock: render RunEvent in ascending id order, timestamp, kind badge and payload. Text/stderr/error as escaped text, tool input as a collapsed safe JSON preview, usage as token counters, session as metadata, rate_limit as reset information. No executable HTML. Only display data supplied by the API. Follow scrolls on new events; scrolling upward turns Follow off. Switching runs clears the previous stream before loading the new one. Clear view clears only rendered lines, never stored events. Keep 2,000 events in view, with Load earlier for retained history. No terminal input in stage 1. The dock and selected audit/skill content require authorized read access.



Tool decisions: enrich tool rows with authoritative agent.tool_decision audit entries or normalized decision payloads correlated by run ID and tool-call ID. Show decision dot, Allowed/Denied, tool name, reason, timestamp, policy hash/version provenance and enforcement source. Expand to safe truncated input plus audit-seq link. A denied call is an attempted call, not executed tool use. A tool event alone means “Decision unreported”, not Allowed. Admit/run-start policy.decision is not a per-call decision. If correlation IDs are missing, render independent timestamped decision rows rather than guessing a match. Filter decision=All/Allowed/Denied/Unreported; keep underlying RunEvent kind filters. Do not invent a new RunEvent.kind until shared contracts define it; fetch run-related audit decisions if needed. An absent Codex decision stream shows “Tool authorization support unverified on this provider” and never an enforcement success. Replay and dedup cover both sources.

## 3. Board (default screen)

Purpose: manage the task queue and inspect live work in a kanban.

### Columns and card anatomy

| Column          | Task.status membership | Default presentation                                       |
| --------------- | ---------------------- | ---------------------------------------------------------- |
| Queued          | queued                 | Expanded; ordered by priority, rank, then ID   |
| Running         | claimed, running       | Expanded; claimed badge “Claimed”, running badge “Running” |
| Rate limited    | rate_limited           | Expanded; reset time if known; no automatic resume         |
| Done            | done                   | Expanded; updatedAt descending                             |
| Failed / Denied | failed, denied         | Expanded; distinct status badges; updatedAt descending     |
| Cancelled       | cancelled              | Collapsed with count; expand on click                      |

Columns are 280 px wide, minimum 260 px, gap 12 px. Scroll horizontally. Header is sticky, displays title and filtered count. Show 50 cards per column initially with Load more; count reflects total matching records, not loaded count. Column emptiness is “No queued/running/rate-limited/completed/failed or denied/cancelled tasks” as applicable.

Card order: key and priority badge; title (two lines with full-title tooltip); exact status dot and label; assignee avatar/initials and name or target label/group; label chips; footer with elapsed duration and tokens. Explicit queued targets show target Agent.name. Label-target queued tasks show “Label: <label>”; group-target tasks show “Group: <name>”. After claim, actual assignment comes from the run if available; during the claim-to-run gap show “Assignment pending”. Label chips are target.label and, when an actual agent exists, Agent.labels; distinguish target from agent labels in tooltips. Do not invent Task.labels.

Elapsed time uses selected/latest Run.startedAt to finishedAt or now; absent run shows “Not started”. Tokens so far are latest run inputTokens + outputTokens; show cachedTokens separately in tooltip, never add cached tokens twice. Card error icon exposes Task.error or latest Run.error. Reset time comes from Run.rateLimitResetsAt; unknown displays “Reset time unknown”. Use Agent.avatar or deterministic initials as specified in section 5. A queued task with no eligible agent shows “No eligible agent” and the dispatcher-supplied reason. It remains queued; all candidate policy denials alone produce denied. Never infer this reason from an empty filtered board or silently fail over to another account. Explicit policy-enabled failover must be displayed with its audited reason.

### Board comparison/list view columns

Board toolbar offers Cards / List; List uses the same filters and selection.

| Name              | Source field                                      | Format                                                 | Sortable |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------ | -------- |
| Key               | Task.key                                          | Monospace link                                         | Yes      |
| Title             | Task.title                                        | Text                                                   | Yes      |
| Status            | Task.status                                       | Dot + label                                            | Yes      |
| Assignee / target | vm.actualAgent from Run.agentId; Task.target      | Name or label                                          | No       |
| Account           | Run.accountId; target Agent.accountId if explicit | Account.name; “Unassigned” for unresolved label/group target | No       |
| Labels            | Task.target.label; actual Agent.labels            | Chips                                                  | No       |
| Priority          | Task.priority                                     | P0–P3 (0–3, P0 highest)                        | Yes      |
| Elapsed           | Run.startedAt, finishedAt                         | Duration                                               | No       |
| Tokens            | Run.inputTokens, outputTokens                     | Sum, cached in tooltip                                 | No       |
| Updated           | Task.updatedAt                                    | Local timestamp                                        | Yes      |

### Toolbar, swimlanes and drag rules

Actions: New task; Cards/List; Refresh; Clear filters. Filters: text (key/title), actual or explicit target agent, target/agent label, actual or explicit target account. Label/group-target tasks unresolved to a run do not match agent/account filters. Add a group filter matching Task.target.agentGroupId or actual Agent.groupIds. Agent/account filter help: “Matches assigned agents and explicit targets; unresolved label and group targets have no account.” Filters never change a task target.

Swimlanes: None default, or Agent. Agent lanes use actual/latest-run agent, falling back to explicit target agent; unresolved label/group targets use “Unassigned targets”. Sort named lanes by agent name, unassigned last. Preserve all status columns and include lane task counts. Collapse lanes locally; lane collapse does not cancel or hide work from totals.

- Priority is P0–P3 stored as 0–3, default P2. Task.rank is double precision; queued cards sort by priority ascending, rank ascending, ID. Only queued cards may be reordered. A drop between cards in the same priority band changes only rank, using neighbor IDs in the reorder request so the server allocates the rank transactionally. Cross-priority drops are rejected with “Use Set priority to change priority.” Show band headings; priority changes use the card menu or details. The server resolves concurrent rank changes and rank precision exhaustion; the browser never rewrites ranks for all cards.
- Dragging across swimlanes does not reassign. Reject with “Dragging cannot reassign tasks.” In this stage task target editing is not available, so create a replacement task if needed.
- Queued, claimed or running cards may be dragged to Cancelled, including its collapsed header, then require confirmation “Cancel <key>? Work already performed will remain in its run history.” Running/claimed cancellation waits for authoritative terminal state.
- All other status drops are invalid. Rate-limited, failed, denied and done cards cannot be dragged to Queued or Running. No retry/resume transition is promised in stage 1.
- Preview the destination, expose invalid cursor and explanation, auto-scroll horizontally at edges. Escape aborts drag. After submit retain source position with pending badge until acknowledgement. On rejection keep canonical state and show the returned reason.
- Provide card menu Set priority (queued only) and Cancel (queued/claimed/running), with the same rules and confirmation, as keyboard equivalents. Also offer Move before/after within the same priority band, using a queued-task picker; the server applies the same rank and state checks. Priority and reorder controls are authorized queue mutations, not local-only order changes.
- Clicking selects Task details; opening logs selects its latest run and opens dock. Do not open logs for a task with no run.

### Live updates

Treat OutboxEvent and RunEvent IDs as exact decimal strings or BigInt internally, never floating-point numbers. Persist only the SSE cursor and harmless view preferences locally, not prompts, credentials or event payloads.

Use GET /api/v1/events. Every SSE event has id equal to its OutboxEvent.id, retained as an exact decimal string. Save the last successfully applied ID and send Last-Event-ID on reconnect; native EventSource reconnect preserves it, and custom clients must explicitly pass the header. Deduplicate replay by ID, apply events in ascending order and advance the cursor only after successful reconciliation. Reconcile by stable entity IDs and refetch the affected view when payloads lack fields. Initial load needs a snapshot/high-water cursor contract to avoid gaps between fetch and subscription (section 12). Treat persisted entity data as authoritative, not event arrival order. Count and card location update together; active filters continue to apply. A selected task remains open if it moves or no longer matches filters, with a banner explaining that it is outside the current view.

If an update invalidates a drag, abort and show “Task state changed while you were dragging. Review the updated card.” Do not optimistically mark cancellation terminal. On disconnect show “Live updates disconnected. Reconnecting…” and retry at 1, 2, 4, 8, 16, then 30 seconds; replay from Last-Event-ID on reconnect, then reconcile selected details and active run events. If the server declares the cursor expired/unavailable, refetch the board and details from a fresh snapshot and establish its high-water cursor; show “Live history refreshed after a replay gap.” Do not use RunEvent.id as the global SSE cursor. While disconnected poll visible lists every 15 seconds; distinguish stale data from run status. Token/duration-only updates must not reorder cards or steal focus. Show duration ticks once per second.

### Details, forms and states

Details share the Tasks panel and task creation form in section 6. No board-specific edit form. Empty board: “No tasks yet. Create your first task.” Initial error: “Could not load the board. Retry.” Per-column fetch failure retains other columns and says “Could not load this column. Retry.”

## 4. Dashboard

Purpose: show fleet activity, accounted usage and account capacity without implying available quota when it is unknown.

Dashboard wireframe expressed as a rendered table:

| Full-width header and account/agent/time filters       |                                                        |
| ------------------------------------------------------ | ------------------------------------------------------ |
| Running tasks / enabled agents / rate-limited accounts | Token totals for selected interval; cost with coverage |
| Accounts and capacity table (60% width)                | Fleet activity and recent failures (40% width)         |
| Recent runs table across full width                    |                                                        |
| Optional selected resource panel                       | Optional run log dock                                  |

KPI fields: count Task.status running and claimed separately; enabled/total Agent.enabled; accounts blocked per usage use case; sum Run.inputTokens/outputTokens/cachedTokens displayed separately. Default interval Today (Organization.timezone midnight to now), alternatives Last 24 hours and Last 7 days. An active run contributes recorded usage, with “Usage may update during the run”. No estimated token counts.

| Name (capacity table) | Source field                                               | Format                                                                   | Sortable |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| Account               | Account.name                                               | Link                                                                     | Yes      |
| Provider / type       | Account.provider, type                                     | Labels                                                                   | Yes      |
| Active runs / slots   | count Run.status=running; Account.limits.maxConcurrentRuns | n / limit                                                                | No       |
| Daily tokens / budget | vm.accountTokensToday; Account.limits.dailyTokenBudget     | Count / count or “No budget set”                                         | No       |
| 5h used               | latest UsageSnapshot.usedPercent where window=5h           | Percent, timestamp tooltip                                               | No       |
| Weekly used           | latest UsageSnapshot.usedPercent where window=weekly       | Percent, timestamp tooltip                                               | No       |
| Reset                 | UsageSnapshot.resetsAt; vm.blockUntil                      | Local timestamp / Unknown                                                | No       |
| Availability          | vm.usageAvailability                                       | Available / Concurrency full / Budget exhausted / Rate limited / Unknown | No       |

Never derive one availability label by looking only at usedPercent. Retain all blocking reasons in details. Show “No snapshot” when absent, snapshot age on every gauge, and “Snapshot from <time>; current quota may differ”. Remaining percent is 100 minus usedPercent only for that window, not subscription balance. Budgets and provider windows remain separate.

Recent runs table uses section 7 columns, newest startedAt first, limited to 10; View all opens Runs with filters. Fleet activity uses latest audit events, no inferred activity. Toolbar: Refresh, account/agent/time filters, Create task. Selecting account, agent or run opens its corresponding details. No dashboard edit form; creation routes to Task form. Empty: “No activity yet. Add an account and agent, then create a task.” Error: “Could not load dashboard data. Retry.” Failed widgets retry independently.

## 5. Agents

Purpose: manage personalized agent principals, their groups, provider bindings and effective permissions.

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Name / avatar | Agent.name, avatar; Principal.avatar | Avatar + link | Yes for name |
| Handle | Principal.handle | agent:<slug> | Yes |
| Role | Agent.role | Leader / Worker / Reviewer | Yes |
| Enabled | Agent.enabled | Dot + Enabled/Disabled | Yes |
| Account | Agent.accountId -> Account.name | Link | No |
| Model | Agent.model | Value / Provider default | Yes |
| Groups | Agent.groupIds -> AgentGroup.name | Chips | No |
| Agent policy | Agent.policyId -> Policy.name/currentVersion | Name · vN / No agent restriction | No |
| Labels | Agent.labels | Chips | No |
| Active runs | count Run.status=running by agentId | Count | No |
| Updated | Agent.updatedAt | Timestamp | Yes |

Toolbar: Create agent, Refresh; search name/slug/handle/persona; role, enabled, account, agent-policy, group and label filters. Row actions: Edit, Enable/Disable, Delete according to authorization. Disable affects future starts and does not cancel running work. Deletion never cascades history and must handle dependency conflicts. Role is workflow metadata, not a human RBAC grant; automatic leader orchestration is later-stage.

### Agent details

Rendered wireframe:

| Header: avatar, name, handle, enabled, Close | |
|---|---|
| Persona and identity | Persona, principal/org ID, slug, role, createdBy/time |
| Git identity | Author/committer name/email and Copy |
| Configuration | Account, model, systemPrompt (collapsed), labels |
| Groups | Group links and contributing group policy versions |
| Effective policy | Rule/value/provenance/enforcement table |
| Effective skills | Skill/version/hash/assignment origin table |
| Active and recent runs | Latest 10, immutable policy/skill snapshots, Open logs |
| Audit history | Latest 20 agent events; Actor and Target links |
| Footer | Edit, Enable/Disable, Delete |

Avatar falls back to deterministic initials. Initials/colour or image URL are supported by Principal.avatar/Agent.avatar; accept only existing approved theme token names for colour. Image URL is an optional http/https URL, no script/data URL. Do not include authentication or secret query strings. Broken images fall back to initials. Stage 1 has no image-upload contract. Agent and principal avatar/name writes must stay synchronized through the use case, not two browser writes.

Persona is shown in full as escaped multiline text; do not treat it as a policy. Configuration shows optional agent policy as one contribution, not a replacement for the org/group baseline. Groups show all memberships, with an empty “No groups”. New runs take current policy and skill versions at start; active runs show their own immutable snapshots even when configuration changes.

| Effective policy rule | Value and merge display | Source levels displayed |
|---|---|---|
| workDirs | Path containment intersection; show effective roots or “No allowed directory” | Org, every setting group, agent; policy link/version |
| maxMode | Most restrictive cap | All setting levels; mark cap-determining values |
| allowedTools | Intersection; absent at all levels = no added restriction; empty = none | All setting levels |
| deniedTools | Union; deny wins | Every level adding a denial |
| dailyTokenBudget | Minimum / Not set | All values, marking limiting values |
| maxRunMinutes | Minimum / Not set | All values, marking limiting values |
| allowedAccountIds | Intersection / unrestricted at all levels / none | All setting levels |
| allowedSkillIds | Intersection / unrestricted at all levels / none | All setting levels |

Each row has Rule, Effective value, Set by, Admission, Runtime, Provider evidence columns. “Set by” is a list, not a single misleading winner; multiple groups are identified by ID/name. Expand for all policy version IDs and source values. Unset means no restriction at that level, never an empty-set restriction. Directory intersections must use server-normalized containment, not literal string intersection.

Admission column uses “Checked at run start”, “Not applicable” or “Unknown”. Runtime uses “Provider enforced”, “Runner enforced”, “Admission only: not enforced on this provider”, “Not applicable” or “Support unverified”, with supporting capability/ADR reference if supplied. Runtime and admission are independent. Claude per-tool authorization is supported through PreToolUse; other rule coverage must come from verified capabilities. Codex coverage is unverified until implementation confirms it. A tool allowlist alone does not prove filesystem or network enforcement. maxRunMinutes is runner cancellation, budgets are admission checks unless capability explicitly says otherwise. Unverified coverage never displays an enforcement success dot.

Effective skills table: Skill.name/id (link), resolved version, full SHA-256 contentHash (short prefix in row, full Copy), origins (org/group/agent assignment IDs and scopes), pinned/current binding, eligibility (Allowed/Excluded by policy/Version conflict). Show resolved union once per skill/version with all contributing assignments. Excluded/conflicting rows appear in a separate explanatory subsection; do not claim they will load. “No effective skills” is valid. Preview is current configuration; Run.skills records exactly what loaded, unaffected by later imports.

Audit history queries actorId=Agent.id OR targetType=agent/targetId=Agent.id, deduped by seq. Where OR is unsupported, merge supported Actor and Target queries for a bounded preview and expose two links. Tool decisions in logs follow the shared dock behavior below.

### Create/edit form

| Field | Validation | Help text |
|---|---|---|
| Name | Trimmed required 1–120 characters | “A readable agent name.” |
| Slug, create only | Unique per org, 1–63 lowercase letters/digits/hyphens; alphanumeric ends; immutable | “Creates the stable handle agent:<slug>.” |
| Avatar | Optional initials/approved colour token or http/https image URL; one mode | “Falls back to initials if unavailable.” |
| Persona | Optional trimmed <=2,000 characters (proposed) | “Who this agent is and how it works; this does not grant permissions.” |
| Account | Required existing same-org Account.id | “Shared account limits apply; API execution is unavailable in stage 1.” |
| Model | Optional <=200 characters | “Blank uses the provider default.” |
| Role | leader/worker/reviewer, default worker | “Workflow role, not a human access role.” |
| System prompt | Optional <=32,000 characters | “Appended instructions; do not include credentials.” |
| Labels | Unique trimmed values, 1–63 characters each, max 32 | “Tasks may target agents by label.” |
| Groups | Zero or more unique existing same-org AgentGroup IDs | “All group policies narrow effective permissions; group skills join the assignments.” |
| Agent policy | Optional same-org Policy.id | “Adds restrictions to org and group policies; cannot widen them.” |
| Enabled | Boolean, default true | “Disabled agents cannot start new runs.” |
| Git name | Required <=120; default <name> (agent-band) | “Git author and committer name.” |
| Git email | Valid email <=254; default <slug>@agents.agent-band.local | “Git author and committer email.” |

Git defaults follow name/slug only until edited. ID/org/handle/createdBy/timestamps are server-generated. Before saving membership or policy changes show effective-rule and skill differences; removal of a restriction must be explicit, not silently widened. Save preserves active run snapshots. Empty: “No agents yet. Create an agent.” Error: “Could not load agents. Retry.” Effective preview failure: “Could not calculate effective configuration. Retry.” Do not display stale preview as current.

## 5A. Agent groups

Purpose: organize agents and apply shared policy, skill assignments and scoped human access.

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Name | AgentGroup.name | Link | Yes |
| Description | AgentGroup.description | Truncated text | Yes |
| Members | count Agent.groupIds containing group ID | Count | No |
| Labels | AgentGroup.labels | Chips | No |
| Group policy | AgentGroup.policyId -> Policy.name/currentVersion | Name · vN / No group restriction | No |
| Skills | SkillAssignment.scope.agentGroupId | Assignment count | No |
| Role bindings | RoleBinding.scope.agentGroupId | Grant count | No |
| Created by / at | AgentGroup.createdBy, createdAt | Handle / timestamp | No for handle; Yes for time |

Toolbar: Create group, Refresh; search name/description, label, policy, member agent. Details: Metadata, Members (name/handle/enabled/account, links), Group policy and rules (current version), Group skill assignments (version/hash/binding mode), Scoped role bindings (subject/role/scope), Audit target group/id. Policy section states “This group narrows member permissions; other group and org policies also apply.” Link each member's effective preview, do not fabricate one universal group-effective policy.

Actions: Edit metadata/policy, Manage members, Assign skill, Remove assignment, Manage role bindings (owner only), Delete. Membership editor operates on Agent.groupIds through the owning agents use case; group.members is a view model, not a new table field. Save one atomic membership change if supported; otherwise disclose partial per-agent successes and never report an all-or-nothing save. Disable changes that cannot be authorized on each affected agent. Removing an agent from a group can remove both restrictions and human access; confirmation previews effective-policy/skill and access changes.

| Create/edit field | Validation | Help text |
|---|---|---|
| Name | Required trim 1–120 characters (proposed) | “A shared group name.” |
| Description | Optional <=2,000 (proposed) | “Describe the group's purpose.” |
| Labels | Same as Agent.labels | “Group labels help filter groups; agent-label targeting still uses Agent.labels.” |
| Policy | Optional existing same-org Policy.id | “Adds restrictions to every member; does not override the org baseline.” |

Create group first, then manage members; keep the steps explicit because membership is owned by Agent. Members picker uses unique same-org Agent IDs, zero or more allowed; disabled agents may remain members. Skill forms use section 7A fixed scope=group ID. Role-binding forms use section 9A fixed scope=group ID and list direct grants here, with inherited org grants separately. No operator may grant itself admin by editing a group. Delete confirmation displays referenced members/assignments/bindings/tasks and lets the server reject unresolved dependencies; never silently cascade or cancel work. Historical runs retain snapshots.

Empty: “No agent groups yet. Create a group.” Members empty: “This group has no agents.” Skills empty: “No skills assigned to this group.” Grants empty: “No direct group role bindings; organization access still applies.” Error: “Could not load agent groups. Retry.” Nested sections retry independently.

## 6. Tasks

Purpose: create work and inspect its lifecycle, assignment, failures and run history.

| Name           | Source field                       | Format                    | Sortable |
| -------------- | ---------------------------------- | ------------------------- | -------- |
| Key            | Task.key                           | Link                      | Yes      |
| Title          | Task.title                         | Text                      | Yes      |
| Status         | Task.status                        | Dot + label               | Yes      |
| Target         | Task.target.agentId, label or agentGroupId       | Agent name / Label / Group | No       |
| Actual agent   | latest Run.agentId                 | Name / Unassigned         | No       |
| Priority       | Task.priority                      | P0–P3                     | Yes      |
| Work directory | Task.workDir                       | Monospace, full tooltip   | Yes      |
| Created by     | Task.createdBy -> Principal.handle | Handle                    | No       |
| Created        | Task.createdAt                     | Timestamp                 | Yes      |
| Updated        | Task.updatedAt                     | Timestamp                 | Yes      |

Default sort createdAt descending. Toolbar: Create task, Refresh, text key/title, status, target type/value, group, actual agent, account via run and priority. Details sections: Overview (all Task fields except full prompt), Prompt (escaped multiline), Target and actual assignment, Error/reasons (Task.error), Runs (section 7 table), Audit (target=task/id). Display latest run summary and Open logs; do not conflate task/run status.

| Create field   | Validation                                                                            | Help text                                                                                             |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Title          | Required trimmed 1–200 characters                                                     | “A short description shown on the board.”                                                             |
| Prompt         | Required nonblank, <=64,000 characters                                                | “Instructions passed to the agent.”                                                                   |
| Work directory | Required absolute path; reject relative paths, NUL and unresolved .. segments         | “Must be inside the agent's effective policy work directories. The server performs final path checks.” |
| Target type    | Exactly one: Agent, Label or Group                                                           | “Select an agent, label or group; the dispatcher evaluates eligible candidates.”                            |
| Agent          | Required if Agent target, existing ID; disabled agents flagged, not silently replaced | “An ineligible agent causes a denied task.”                                                           |
| Label          | Required if Label target, trimmed 1–63 characters                                     | “Matching agents are evaluated individually; denied candidates are skipped.”                          |
| Priority       | Required P0–P3; default P2                                                            | “P0 is highest; equal priorities follow manual rank.”                                              |

Group target: required existing same-org AgentGroup.id when type=Group, help “Uses an eligible member without silent cross-account failover.” Requested mode: optional read-only/edit/full-auto (Task.mode), help “The run uses the requested mode capped by effective maxMode; blank uses the effective cap.” Key/id/status/actor/timestamps/errors and initial rank are generated by the server. Clear inactive target fields on target-type switch. Validate directory syntax in UI, but policy normalization and filesystem containment are authoritative on server. Show a warning when a label or group has no eligible agent; allow submission since the fleet can change. Details show the server's queued eligibility reason without converting it to a new lifecycle status.

No generic task editing endpoint exists in the design. Prompt, target, workDir and title are read-only after creation. Queued-only priority changes and rank reordering are supported per Board; cancel action available for queued/claimed/running, no retry/resume in stage 1. Confirmation and pending behavior follow Board. Empty: “No tasks yet. Create your first task.” Error: “Could not load tasks. Retry.” Missing selected item: “This task is no longer available.”

## 7. Runs

Purpose: inspect immutable execution context, recorded usage and normalized live events.

| Name                    | Source field                                | Format        | Sortable             |
| ----------------------- | ------------------------------------------- | ------------- | -------------------- |
| Run                     | Run.id                                      | Short ID link | Yes                  |
| Task                    | Run.taskId -> Task.key                      | Key           | No                   |
| Agent                   | Run.agentId -> Agent.name                   | Name          | No                   |
| Account                 | Run.accountId -> Account.name               | Name          | No                   |
| Status                  | Run.status                                  | Dot + label   | Yes                  |
| Started                 | Run.startedAt                               | Timestamp     | Yes                  |
| Duration                | Run.startedAt, finishedAt                   | Duration      | No                   |
| Input / output / cached | Run.inputTokens, outputTokens, cachedTokens | Three counts  | Yes, each separately |
| Cost                    | Run.costUsd                                 | USD / Unknown | Yes                  |
| Policy                  | Run.effectivePolicy (contributing policy version IDs)                 | Name · vN     | No                   |
| Worker                  | Run.workerId                                | Monospace ID  | Yes                  |

Default startedAt descending. Toolbar: Refresh, text run ID/task key, status, agent, account, policy, started time range. Details: Context (all identifiers including worker), Lifecycle (status/start/finish/exitCode/error/reset time), Usage (three token counts and optional cost), Policy snapshot (Run.effectivePolicy rules, contributing version IDs and hash, not current rules), Skills snapshot (Run.skills IDs/versions/content hashes), Events (kind filters), Audit (target=run/id plus agent action links). Open logs opens dock. Cancel task routes to the task cancellation action only while Task status allows it; never invent a run-delete endpoint.

No create/edit form: runs are produced by the dispatcher and history is read-only. Event filters cover text/tool/usage/rate_limit/error/stderr/session; within a run, cursor/event-ID paging retains ascending order. Unknown event kinds render a JSON preview rather than dropping data. Empty: “No runs yet. Runs appear when tasks start.” Error: “Could not load runs. Retry.” Log error: “Could not load run events. Retry.” During a terminal run show “Run finished” and keep logs available.

## 7A. Skills

Purpose: manage immutable skill bundles and assign their versions to organizations, agent groups and agents.

### Library and where used

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Name | Skill.name | Link | Yes |
| Description | Skill.description | Truncated text | Yes |
| Current version | Skill.currentVersion | vN | Yes |
| Content hash | current SkillVersion.contentHash | SHA-256 prefix + full Copy | No |
| Source | SkillVersion.source and origin | Upload / Local path / Git; origin tooltip | No |
| Bundle size | vm.bytes from SkillVersion.files | Bytes, max 5 MB | No |
| Assignments | count SkillAssignment.skillId | Count | No |
| Created by / at | Skill.createdBy, createdAt | Handle / timestamp | No for handle; Yes for time |

Toolbar: Import skill, Refresh; search name/description, source, assigned scope type/ID. Select a skill for Details tabs: Overview, Versions, Assignments, Where used, Audit. Overview: id/orgId/name/description/current version/creator/time. Versions: version, contentHash, source/origin, total bytes/file count, createdBy/time; pick one to inspect file tree and escaped SKILL.md/supporting text. Show binary metadata only; never execute imported code in the browser. Every displayed content hash is the server-computed SHA-256 of the bundle; don't infer it from SKILL.md alone. Historical files and hashes are immutable. Import version explicitly creates a new version; edit metadata must not rewrite its content.

Assignments table: SkillAssignment.id, scope (Org / group link / agent link), pinnedVersion or “Always current”, resolved version/hash, createdBy/time. Sort only createdAt; filter scope and binding mode. Where used: Scope / direct assignment ID / version mode / resolved version / effective agents / excluded-by-policy agents / historical run count. Agent lists link to effective previews. History subtable uses Run.skills matched by skillId, displaying run/task/agent/version/hash/start; historical usage persists after assignment removal. Counts are server-derived and org-scoped; never present direct assignments alone as effective usage.

### Import flow

1. Choose New skill or New version for an existing Skill.id. New requires name/description; existing skill identity is locked and rules do not automatically change metadata.
2. Choose source Upload zip / Local path / Git URL. Render exactly one source input, clear the inactive values.
3. Validate syntax then request a server-side import preview. Show resolved origin/revision, root, file list/count, total decoded bytes, discovered SKILL.md and computed bundle hash. Warn that skills are instructions/code and policy controls execution.
4. Confirm Import; server revalidates/materializes immutable bytes and returns SkillVersion/version/hash. Bind preview to content or recompute if the source changed; do not save stale previews. Import never auto-assigns the skill.
5. Select the saved version and optionally open Assign skill as a separate explicit action. Failed imports leave prior versions and assignments unchanged.

| Form field | Validation | Help text |
|---|---|---|
| Name (new skill) | Required trim 1–120 characters (proposed) | “Readable library name.” |
| Description | Optional <=2,000 characters (proposed) | “Explain what the skill provides.” |
| Source | Required upload/path/git | “Import creates an immutable snapshot, not a live mount.” |
| Zip file | One .zip, proposed upload cap 5 MB; decoded bundle must be <=5 MB | “Include a root SKILL.md and supporting files.” |
| Local path | Required absolute path to a directory, no NUL/traversal | “Read on the server/runner host; this is not your browser's filesystem.” |
| Git URL | Required credential-free https URL; no userinfo/token query | “The server fetches a repository snapshot; credentials are not embedded in URLs.” |
| Git revision | Optional branch/tag/commit (proposed) | “Blank resolves the default branch; import records the resolved commit.” |
| Bundle subdirectory | Optional relative normalized directory (proposed), no escape | “Select the folder containing SKILL.md; blank uses repository root.” |

Server must reject archives with escaping paths, duplicate normalized file names, symlink escapes, unreadable files, missing SKILL.md or decoded bundle >5 MB. Proposed root layout requires SKILL.md at selected bundle root; preview may offer choosing a single enclosing directory rather than silently changing roots. Never silently truncate oversized bundles or execute installers. “5 MB” exact byte threshold and git authentication support remain contract gaps; until finalized apply authoritative server errors. For source material not on server host, use zip. No automatic upstream synchronization.

### Assignment form

| Field | Validation | Help text |
|---|---|---|
| Skill | Existing same-org Skill.id; fixed from detail | “Select the skill to make available.” |
| Scope type | Exactly org/group/agent | “Skills union across these levels, then policy filters them.” |
| Scope target | Current org or required existing same-org group/agent ID | “Choose the assignment's scope.” |
| Version mode | Always current (default) / Pin version | “Current follows future imports for new runs; pin uses an immutable version.” |
| Pinned version | Required existing SkillVersion.version when pinned | “Running executions retain the version they loaded.” |

Always current omits pinnedVersion; pin sends an explicit version. Prevent identical duplicate assignments to the same scope/skill as a proposed UI rule; handle server conflicts. Different assignment levels do not override one another. If pins conflict across levels show “Conflicting skill versions. Resolve assignments before running.” and preserve the origins; final resolution is server-defined, not most-specific-wins. Effective preview shows allowedSkillIds exclusions without deleting assignments. Remove assignment confirmation names scope and skill; active/history runs keep loaded bytes/version/hash records. Delete skill is separate and server-controlled when referenced.

Empty: “No skills yet. Import a skill bundle.” Where-used empty: “This skill is not assigned and has no recorded runs.” Versions loading error: “Could not load skill versions. Retry.” Import error: “Could not import skill. Review the source and try again.” Assignment error: “Could not save skill assignment. Review the reported conflict.” Library error: “Could not load skills. Retry.”

## 8. Policies

Purpose: maintain versioned restrictions at organization, group and agent levels with most-restrictive merging.

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Name | Policy.name | Link | Yes |
| Version | Policy.currentVersion | vN | Yes |
| Max mode | current PolicyVersion.rules.maxMode | Cap / Unset | No |
| Work directories | rules.workDirs | Count / Unset / None allowed | No |
| Daily budget | rules.dailyTokenBudget | Tokens / Unset | No |
| Max duration | rules.maxRunMinutes | Minutes / Unset | No |
| Bindings | Organization.policyId; AgentGroup.policyId; Agent.policyId | Org/group/agent counts | No |
| Created by / at | Policy.createdBy, createdAt | Handle / timestamp | No for handle; Yes for time |

Toolbar: Create policy, Refresh, search name/description, maxMode, binding level. Details: Metadata, Current rules, Bindings by level, Versions (version/createdBy/createdAt) and read-only diff, audit. Select a historical version without changing currentVersion. Metadata editing updates name/description in place. Save rules creates a new immutable version; do not edit past rules or auto-rebind active run snapshots. Policy deletion handles dependencies without erasing snapshots.

| Form field | Validation | Help text |
|---|---|---|
| Name | Required trim 1–120 | “Readable policy name; editable without a new rules version.” |
| Description | Optional <=2,000 characters | “Describe the intended scope.” |
| Work directories | Optional absolute normalized paths; no NUL/traversal; unique | “Unset adds no restriction. An explicit empty list allows no directory.” |
| Maximum mode | Optional read-only/edit/full-auto | “A cap; lower levels cannot grant a higher mode.” |
| Allowed tools | Optional unique nonblank tool names | “Intersects other allowlists. Empty explicitly allows none.” |
| Denied tools | Optional unique nonblank names; reject overlap with this policy's allowed list | “Denials are combined from every level.” |
| Daily token budget | Optional positive safe integer | “The lowest applicable budget wins.” |
| Maximum run minutes | Optional positive safe integer | “The runner cancels at the lowest applicable timeout.” |
| Allowed accounts | Optional same-org Account IDs | “Intersects restrictions from all levels; empty allows none.” |
| Allowed skills | Optional same-org Skill IDs | “Only the effective allowed skills may load; empty allows none.” |

Every optional rule has an “Inherit / Set restriction” control. Inherit omits the field; Set restriction may intentionally send an empty list. Never turn an empty restriction into omission or vice versa. Clearing a restriction displays the resulting effective widening in affected agents before confirmation. A fully unset policy adds no restriction, not a default full-auto promise; baseline/default effective mode behavior is a remaining contract issue. Show runtime coverage only per concrete provider as in section 5, not a global policy “enforced” badge. Empty: “No policies yet. Add a policy to restrict agents.” Error: “Could not load policies. Retry.”

## 9. Accounts

Purpose: register shared provider credentials and inspect concurrency, budgets and provider limit windows.

| Name             | Source field                     | Format                             | Sortable |
| ---------------- | -------------------------------- | ---------------------------------- | -------- |
| Name             | Account.name                     | Link                               | Yes      |
| Provider         | Account.provider                 | Claude / OpenAI                    | Yes      |
| Type             | Account.type                     | CLI / API (unavailable in stage 1) | Yes      |
| Labels           | Account.labels                   | Chips                              | No       |
| Concurrent limit | Account.limits.maxConcurrentRuns | Integer                            | Yes      |
| Daily budget     | Account.limits.dailyTokenBudget  | Count / Not set                    | Yes      |
| Availability     | vm.usageAvailability             | Text + dot                         | No       |
| Updated          | Account.updatedAt                | Timestamp                          | Yes      |

Toolbar: Add account, Refresh, text name, provider/type/label. Details: Configuration (id/name/provider/type/configDir/labels/limits/actor/timestamps); Credentials (Account.hasSecret and secretUpdatedAt: “Secret configured” or “No secret configured”, plus last-updated timestamp); Latest 5h/weekly snapshots (usedPercent/ts/resetsAt); Availability with every blocking reason; Agents; recent Runs; Audit target account/id. No reveal secret action. Delete disabled during active runs; server rejects dependencies without implicit cascade. Confirmation includes bound-agent count.

| Create/edit field           | Validation                                                            | Help text                                                                                                           |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Name                        | Required trim 1–120 characters                                        | “Identifies this shared provider account.”                                                                          |
| Provider                    | Required claude/openai; immutable after create                        | “Select the installed CLI provider.”                                                                                |
| Type                        | Required cli/api; immutable after create                              | “API accounts can be registered but cannot run in stage 1.”                                                         |
| Config directory (CLI only) | Optional absolute path, no NUL/traversal                              | “Claude uses CLAUDE_CONFIG_DIR; OpenAI uses CODEX_HOME. Blank uses the CLI default; no quota isolation is implied.” |
| API secret (API only)       | Required on create, optional write-only replacement on edit; nonblank | “Stored encrypted; never returned or displayed after saving.”                                                       |
| Labels                      | Same validation as Agent.labels                                       | “Groups accounts for filtering.”                                                                                    |
| Daily token budget          | Optional positive safe integer                                        | “Shared by all agents using this account.”                                                                          |
| Maximum concurrent runs     | Required positive safe integer; default 1                             | “Shared execution slots for this account.”                                                                          |

Never prefill API secret; blank edit preserves it. Render Password input, no credential values in browser storage, analytics, error logs or URL. Config directory is a path, not a credential upload. Clear secret input on success and close. CLI login always happens in the provider's own flow. agent-band does not read, store or proxy CLI session tokens. When a safe signed-in provider identity is supplied, show it and any linked Account IDs sharing counters/blocks; separate local Account records do not multiply provider limits. Empty: “No accounts yet. Add a provider account.” Error: “Could not load accounts. Retry.”

## 9A. People and teams

Purpose: inspect human identities, team memberships and scoped access without confusing them with agent workflow roles.

Tabs: People (default), Teams, Role bindings. Stage 1 displays user:local, active, with an org-scope owner binding; no login, invitation or fake additional identities. Many-user list/detail components are defined here for later identity provisioning. Stage 1 create-user/invite controls are disabled with “User provisioning arrives with multi-user authentication”; supported team/binding management still uses real authorization.

### People table and details

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Name / avatar | Principal.displayName, avatar | Avatar + link | Yes for name |
| Handle | Principal.handle | Monospace | Yes |
| Email | User.email | Email / Not set | Yes |
| Status | User.status | Active / Disabled + dot | Yes |
| Teams | Team.members contains User.principalId | Team links | No |
| Direct roles | RoleBinding.subject.userId | Role + scope chips | No |
| Created | Principal.createdAt | Timestamp | Yes |

Toolbar: Refresh; search displayName/handle/email; status, team, role and scope filters. Role filter includes effective direct and team grants, with “Inherited via <team>” visible. Details: Principal identity (id/org/kind/handle/displayName/avatar/createdAt); user email/status; team memberships; direct bindings; inherited team bindings; effective resource-access preview; Audit actor/target links. Denial reasons are retained, not shown as a new stored user status.

Human display-name/avatar/email/status editing fields: displayName required trim 1–120; avatar validation as Agents; optional valid email <=254; status active/disabled. These are proposed fields for an identity-management contract, not a working stage 1 user edit endpoint. Handle/principal ID/org/kind are immutable. Until supported render read-only, not a Save button that fails. Disabled is an identity flag; API authorization must honor it according to shared contracts. Guard disabling/removing the last active org owner including user:local; explain “At least one active organization owner is required.”

Empty: “No people available.” Stage 1 should always show local owner, so absence also prompts Refresh and a configuration-error banner. Error: “Could not load people. Retry.” Audit empty: “No activity recorded for this person.”

### Teams table, details and forms

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Name | Team.name | Link | Yes |
| Description | Team.description | Truncated text | Yes |
| Members | Team.members | Count | No |
| Role bindings | count RoleBinding.subject.teamId | Count | No |
| Scopes | RoleBinding.scope for team | Scope chips | No |

Toolbar: Create team, Refresh; search name/description, member user, role, scope. Details: id/org/name/description; Members (displayName/handle/email/status); Direct team grants; Effective access by scope; Audit target team/id. Edit and Manage members are admin/owner actions subject to authorize(); management of role grants is owner-only. Group admin does not gain org-wide team management by implication.

Create/edit: name required trim 1–120, description optional <=2,000; members zero or more unique same-org User.principalId values, including disabled users clearly flagged. Help: “Members inherit this team's role bindings; disabled users do not gain active access.” Membership save previews affected roles/scopes and requires authoritative server authorization. No new human principal is created by adding a member. Delete confirmation lists inherited access that will be removed, checks last-owner guard and dependencies, then calls server; no silent historical audit deletion.

Empty: “No teams yet. Create a team.” Members empty: “This team has no members.” Error: “Could not load teams. Retry.”

### Role bindings table, details and form

| Name | Source field | Format | Sortable |
|---|---|---|---|
| Subject | RoleBinding.subject.userId or teamId | User / Team link | No |
| Role | RoleBinding.role | Owner / Admin / Operator / Viewer | Yes |
| Scope | RoleBinding.scope.org, agentGroupId or agentId | Organization / Group / Agent link | No |
| Binding ID | RoleBinding.id | Short ID + Copy | Yes |

Toolbar: Add role binding (owner), Refresh; subject kind/ID, role, scope type/ID filters. Details show exact subject/role/scope/id/orgId, impacted members/agents and audit. No fake createdAt field: RoleBinding does not list one. Show direct vs inherited access separately; union additive grants via direct/team bindings, never reduce higher grants based on a viewer binding. Scope links must reference the same org.

| Create/edit field | Validation | Help text |
|---|---|---|
| Subject type | Exactly User or Team | “A human access grant; agents are not RBAC subjects here.” |
| Subject | Required existing same-org user/team ID | “Teams pass this grant to their human members.” |
| Role | owner/admin/operator/viewer | “Choose the allowed actions shown below.” |
| Scope type | Exactly Organization / Agent group / Agent | “A group scope applies to its member agents.” |
| Scope | Current org or required same-org AgentGroup/Agent ID | “Does not grant access to unrelated resources.” |

Disable inactive selector values and submit exactly one subject and scope discriminant. Reject identical duplicate grants as a proposed client rule. Require a change summary listing subject, role and scope for create/update/revoke; resource-independent owner-only grant management prevents self-escalation. Owner creation uses org scope in stage 1; other owner scopes are disabled until semantics are defined. Revoke last active org owner is blocked. Server denial (403) shows “You do not have permission to change this role binding.” Keep input and refresh effective access after success.

| Role | Effective UI capabilities, within scope |
|---|---|
| Viewer | Read permitted resources, details and logs; no mutation or audit export |
| Operator | Viewer plus create/cancel tasks on agents in scope; queue reorder/priority require explicit authorization contract |
| Admin | Operator plus manage agents, groups, policies, skills and accounts in scope; team management requires authorization on that org resource |
| Owner | All permitted actions, including role-binding management and audit export |

Org-level skills/accounts/policies and label/group task selectors require backend scope resolution. Never assume a scoped admin can edit a shared resource affecting agents outside its scope. Hide unauthorized primary creation actions; disable visible contextual actions with an explanatory tooltip when capabilities are known. A failed server authorize is definitive even if a cached UI capability allowed the button. 403 message: “You do not have permission for this action.” Access-denied screen: “You do not have access to this resource.” Audit authz.denied events remain inspectable by authorized viewers.

Bindings empty: “No direct role bindings for this selection.” Error: “Could not load role bindings. Retry.”

## 10. Audit

Purpose: inspect attributable control-plane and agent actions, verify the hash chain and export evidence.

| Name        | Source field                           | Format                                       | Sortable |
| ----------- | -------------------------------------- | -------------------------------------------- | -------- |
| Sequence    | AuditEvent.seq                         | Exact decimal string; do not round bigserial | Yes      |
| Time        | AuditEvent.ts                          | Timestamp                                    | No       |
| Actor       | AuditEvent.actorId -> Principal.handle | Kind badge + handle                          | No       |
| Action      | AuditEvent.action                      | Monospace literal                            | No       |
| Target type | AuditEvent.targetType                  | Literal                                      | No       |
| Target      | AuditEvent.targetId                    | Link where supported, otherwise ID           | No       |
| Summary     | AuditEvent.data                        | Allowlisted short preview                    | No       |

Default seq descending; only sequence sort is supported so cursor navigation is stable. Toolbar filters: actor searchable principal picker, exact action multi-select, target type, exact target ID, From/To date-times (inclusive From, exclusive To converted to UTC), text limited to exact target ID or action, Clear filters, Refresh, Verify chain, Export JSONL. No arbitrary data substring search without a supported endpoint.

Action options include create/update/delete for accounts, agents, agent groups, policies, skills, skill assignments, teams and role bindings; task.create/cancel; policy.decision; authz.denied; run.start/finish; agent.tool_use; agent.tool_decision; run.rate_limited. Populate exact new action literals from the shared contracts instead of guessing resource spelling. Tool decisions show allow/deny and reason separately from actual tool use. Unknown action strings remain visible and can be copied. Target type selection does not imply all policy decisions use policy as target; data and API filtering contract are authoritative.

Details: sequence/time, resolved actor with ID/kind/handle, exact action, target type/ID, safely formatted full supplied data, prevHash/hash with Copy, links to related resources only when IDs/types are known. Tool input remains the already-truncated logged value; UI cannot reconstruct original input. No create/edit/delete form or controls.

Chain indicator is independent of list filters:

- “Not verified” initially; “Verifying…” while pending.
- Success “Verified sequences <fromSeq>–<toSeq> at <time>”, using the returned range. Label it “Full chain” only when the returned range covers the chain from its origin through the selected high-water sequence.
- Failure “Chain verification failed at sequence <N>” only if the endpoint supplies that sequence; otherwise “Chain verification failed”. Details show supplied mismatch/reason.
- Request failure “Verification unavailable. Retry.” is different from invalid chain.
- New events after verification change indicator to “Verified through <N>; newer events not verified”. A filtered table cannot itself establish full-chain integrity.
- Request full-chain verification by default; a Range option supplies optional fromSeq/toSeq positive decimal strings with fromSeq <= toSeq. Never label an incomplete range as fully verified. Display the boundary/anchor used by the server when provided; verification checks the orgId included in each hashed event.

Export: owner-only action exports JSONL using exactly the current list filters and a frozen toSeq high-water mark supplied by the server. Dialog summarizes filters, org and bound; offer Filtered events or All events. State “Filtered exports can omit intermediate chain entries; verify against a full export.” Each line contains complete AuditEvent fields including orgId and hashes. Stream download named agent-band-audit-<UTC timestamp>.jsonl. Events after toSeq are excluded; do not export only loaded rows. If the high-water mark cannot be obtained, block export with “Could not establish an export snapshot. Retry.” No contents retained in UI storage. Export failure: “Could not export audit events. Retry.” Normal empty: “No audit events recorded yet.” Filter empty: “No audit events match these filters.” Error: “Could not load audit events. Retry.”

## 11. Status vocabulary and keyboard shortcuts

These tables cover every enum named status in the domain model, including User.status. Principal.kind, Agent.role, Account.provider/type, policy mode, RunEvent.kind and snapshot window are categories, not lifecycle statuses, and use neutral badges.

| Resource                     | Value               | Label               | Dot token  |
| ---------------------------- | ------------------- | ------------------- | ---------- |
| Task                         | queued              | Queued              | --muted    |
| Task                         | claimed             | Claimed             | --warn     |
| Task                         | running             | Running             | --ok       |
| Task                         | done                | Done                | --ok       |
| Task                         | failed              | Failed              | --crit     |
| Task                         | rate_limited        | Rate limited        | --warn     |
| Task                         | cancelled           | Cancelled           | --text-dim |
| Task                         | denied              | Denied              | --crit     |
| Run                          | running             | Running             | --ok       |
| Run                          | done                | Done                | --ok       |
| Run                          | failed              | Failed              | --crit     |
| Run                          | rate_limited        | Rate limited        | --warn     |
| Run                          | cancelled           | Cancelled           | --text-dim |
| Agent                        | enabled=true        | Enabled             | --ok       |
| Agent                        | enabled=false       | Disabled            | --text-dim |
| User | active | Active | --ok |
| User | disabled | Disabled | --text-dim |

Additional UI indicators: Available --ok; Concurrency full, Budget exhausted, Rate limited --warn; Unknown --muted; queued eligibility “No eligible agent” --warn (not a new Task.status); tool decisions Allowed --ok / Denied --crit / Unreported --muted; live Connected --ok / Reconnecting --warn; verification Valid --ok / Invalid --crit / Not verified or unavailable --muted / newer unverified --warn. Outbox is an internal replay log, has no lifecycle status in the current model and is never exposed as a new screen. Skills, groups, teams and policies have no stored lifecycle status field. Account has no stored status field. A denied run does not exist in the model; denial belongs to Task.

Shortcuts (8 total; disable character shortcuts in text inputs/editors):

1. /: focus screen search.
2. Alt+1: Board.
3. Alt+2: Dashboard.
4. Alt+3: Agents.
5. Alt+4: Tasks.
6. Alt+5: Runs.
7. Escape: dismiss topmost form, details or dock in that order; cancel active drag first.
8. Enter on focused row/card: open details.

Standard Tab/Shift+Tab and native button activation remain available. Tooltips advertise shortcuts; provide a preference to disable navigation shortcuts if browser/OS conflicts occur.

## 12. Implementation assumptions and remaining contract gaps

Decided: P0–P3 plus rank; budget days use Organization.timezone (IANA, host default); no eligible label/group target stays queued with a reason; SSE id and Last-Event-ID replay; audit verify range and filtered export bound; editable policy name/description; hasSecret/secretUpdatedAt; original form limits accepted, with shared zod schemas authoritative.

The following remain explicitly proposed or unspecified:
- The Domain model list must incorporate Task.rank and Organization.timezone/policyId from the normative decisions. UI uses these decided fields. Initial SSE snapshot/high-water cursor and expired replay signaling need response shapes; replay retention length is unspecified.
- If no level sets maxMode, the default effective mode must be defined by the policy contract; UI shows “No mode cap configured” until resolved, without implying full-auto. Owner access on narrow scopes and task queue mutation permissions also need explicit semantics.
- Multiple skill assignments may select different pinned versions of the same skill. Do not invent override precedence: effective preview must return a resolved version or an explicit conflict. Block a conflicting assignment before save when known; dispatcher remains authoritative.
- Skill import errors, archive root rules, exact 5 MB byte threshold, git revision/authentication, policy exclusion handling and hash canonicalization need contracts. Proposed zip/path/git form validation and preview/commit flow below must be mirrored in zod.
- Effective policy provenance and provider enforcement need a view model listing every contributing level and verified capability per rule. Do not infer capabilities from provider names, policy mode or configured tool lists. Runtime tool-decision RunEvent payload/kind must be specified; audit remains authoritative.
- Group/team membership writes and RBAC grant-management endpoints must provide atomic updates and stale-write checks. User/Team field limits below are proposed. Multi-user identity creation/authentication is later-stage; stage 1 must not fake invitations or login.
- Define handling of owner grants on non-org scopes, the last active org owner, and deletion of referenced groups/teams/users. Conservative UI guards below do not replace server authorization.
- API-secret replacement semantics and account provider-identity metadata fields are not enumerated in the domain model. The decided safe credential status is available; signed-in provider identity and shared blocks need safe response fields.
- Cross-account failover is explicit, off by default and audited, but its policy field and selection algorithm are unspecified. Do not offer a working enable toggle until a shared contract exists.
- Audit history OR queries and exact literals for new actions/target types require contracts; views may merge two supported queries with seq deduplication.
- Form size limits are authoritative in zod; historical related-resource names may be current names. IDs, effective policy snapshots and Run.skills versions/hashes remain authoritative.

### Lens patterns

Copy: compact rail plus resource sidebar; dense tables with stable identity columns; selection-driven details; a resizable followable log dock; clear connection state and contextual resource links.

Avoid: terminal-like controls implying unrestricted access; colour-only state; hidden critical columns on narrow windows; auto-scrolling logs while a user reads history; excessive modal navigation; showing stale quota as current capacity; policy controls that imply unsupported provider enforcement.
