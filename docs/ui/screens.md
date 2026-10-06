# Stage 1 UI screen specification

Language: English. Source of truth: [stage 1 design, rev 2](../superpowers/specs/2026-10-06-agent-band-design.md). Scope: localhost control plane, without scheduling, automatic resume, remote runners or working API adapters.

## 1. Contract and shared conventions

Paths below are domain field paths, not promises about an existing HTTP response shape. Relationship joins and aggregates must be served by resource use cases or UI view models, never direct cross-module table access. Prefix `vm.` marks a derived display field. This document defines UI behavior; additions requiring architect approval are listed in section 12.

All stage 1 UI mutations are attributed to `user:local`. Never expose Account.secret or encrypted secret values. Provider limits cannot be bypassed. Policy versions and audit records are immutable.

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
| Icon rail        | 48 px fixed                                       | Workspace icon (Board), execution icon (Dashboard/Agents/Tasks/Runs), governance icon (Policies/Accounts/Audit); each selects its sidebar group, with tooltip                                    |
| Resource sidebar | 208 px default; 180–280 px resize                 | Workspace: Board, Dashboard. Execution: Agents, Tasks, Runs. Governance: Policies, Accounts, Audit. All groups expanded initially, current item highlighted. Footer: user:local and theme toggle |
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
| Execution  | Board, Dashboard, Agents, Tasks, Runs | Toolbar, 44 px+                        | Scrollable sections       |
| Governance | Policies, Accounts, Audit             | Board/table/dashboard                  | Contextual actions        |
|            | User and theme                        | Bottom dock, spanning main and details | Bottom dock               |

Theme: dark default, light selectable; persist locally. Use existing design tokens for surfaces and typography. This specification adds no palette beyond status tokens.

Dock: render RunEvent in ascending id order, timestamp, kind badge and payload. Text/stderr/error as escaped text, tool input as a collapsed safe JSON preview, usage as token counters, session as metadata, rate_limit as reset information. No executable HTML. Only display data supplied by the API. Follow scrolls on new events; scrolling upward turns Follow off. Switching runs clears the previous stream before loading the new one. Clear view clears only rendered lines, never stored events. Keep 2,000 events in view, with Load earlier for retained history. No terminal input in stage 1.

## 3. Board (default screen)

Purpose: manage the task queue and inspect live work in a kanban.

### Columns and card anatomy

| Column          | Task.status membership | Default presentation                                       |
| --------------- | ---------------------- | ---------------------------------------------------------- |
| Queued          | queued                 | Expanded; ordered by priority, then creation time and ID   |
| Running         | claimed, running       | Expanded; claimed badge “Claimed”, running badge “Running” |
| Rate limited    | rate_limited           | Expanded; reset time if known; no automatic resume         |
| Done            | done                   | Expanded; updatedAt descending                             |
| Failed / Denied | failed, denied         | Expanded; distinct status badges; updatedAt descending     |
| Cancelled       | cancelled              | Collapsed with count; expand on click                      |

Columns are 280 px wide, minimum 260 px, gap 12 px. Scroll horizontally. Header is sticky, displays title and filtered count. Show 50 cards per column initially with Load more; count reflects total matching records, not loaded count. Column emptiness is “No queued/running/rate-limited/completed/failed or denied/cancelled tasks” as applicable.

Card order: key and priority badge; title (two lines with full-title tooltip); exact status dot and label; assignee avatar initials and name or target label; label chips; footer with elapsed duration and tokens. Explicit queued targets show target Agent.name. Label-target queued tasks show “Label: <label>”. After claim, actual assignment comes from the run if available; during the claim-to-run gap show “Assignment pending”. Label chips are target.label and, when an actual agent exists, Agent.labels; distinguish target from agent labels in tooltips. Do not invent Task.labels.

Elapsed time uses selected/latest Run.startedAt to finishedAt or now; absent run shows “Not started”. Tokens so far are latest run inputTokens + outputTokens; show cachedTokens separately in tooltip, never add cached tokens twice. Card error icon exposes Task.error or latest Run.error. Reset time comes from Run.rateLimitResetsAt; unknown displays “Reset time unknown”. Avatar has deterministic initials, no external avatar request.

### Board comparison/list view columns

Board toolbar offers Cards / List; List uses the same filters and selection.

| Name              | Source field                                      | Format                                                 | Sortable |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------ | -------- |
| Key               | Task.key                                          | Monospace link                                         | Yes      |
| Title             | Task.title                                        | Text                                                   | Yes      |
| Status            | Task.status                                       | Dot + label                                            | Yes      |
| Assignee / target | vm.actualAgent from Run.agentId; Task.target      | Name or label                                          | No       |
| Account           | Run.accountId; target Agent.accountId if explicit | Account.name; “Unassigned” for unresolved label target | No       |
| Labels            | Task.target.label; actual Agent.labels            | Chips                                                  | No       |
| Priority          | Task.priority                                     | P0–P3, assumption in section 12                        | Yes      |
| Elapsed           | Run.startedAt, finishedAt                         | Duration                                               | No       |
| Tokens            | Run.inputTokens, outputTokens                     | Sum, cached in tooltip                                 | No       |
| Updated           | Task.updatedAt                                    | Local timestamp                                        | Yes      |

### Toolbar, swimlanes and drag rules

Actions: New task; Cards/List; Refresh; Clear filters. Filters: text (key/title), actual or explicit target agent, target/agent label, actual or explicit target account. Label-target tasks unresolved to a run do not match agent/account filters. Agent/account filter help: “Matches assigned agents and explicit targets; unresolved label targets have no account.” Filters never change a task target.

Swimlanes: None default, or Agent. Agent lanes use actual/latest-run agent, falling back to explicit target agent; unresolved label targets use “Unassigned label targets”. Sort named lanes by agent name, unassigned last. Preserve all status columns and include lane task counts. Collapse lanes locally; lane collapse does not cancel or hide work from totals.

- Only queued cards may be reordered in Queued. Dragging sets priority according to the destination priority band P0–P3; priority bands have visible headings. Within an equal-priority band order remains createdAt ascending, then ID. Do not imply persisted arbitrary rank, because Task has no rank field.
- Dragging across swimlanes does not reassign. Reject with “Change the task target in its details; dragging cannot reassign tasks.” In this stage task target editing is not available, so create a replacement task if needed.
- Queued, claimed or running cards may be dragged to Cancelled, including its collapsed header, then require confirmation “Cancel <key>? Work already performed will remain in its run history.” Running/claimed cancellation waits for authoritative terminal state.
- All other status drops are invalid. Rate-limited, failed, denied and done cards cannot be dragged to Queued or Running. No retry/resume transition is promised in stage 1.
- Preview the destination, expose invalid cursor and explanation, auto-scroll horizontally at edges. Escape aborts drag. After submit retain source position with pending badge until acknowledgement. On rejection keep canonical state and show the returned reason.
- Provide card menu Set priority (queued only) and Cancel (queued/claimed/running), with the same rules and confirmation, as keyboard equivalents. Priority mutation is an API gap requiring approval; until supported show disabled menu item and disable reorder.
- Clicking selects Task details; opening logs selects its latest run and opens dock. Do not open logs for a task with no run.

### Live updates

Use GET /api/v1/events; reconcile by stable entity IDs and refetch the affected view when payloads lack fields. Deduplicate events by their supplied identity when available; absent replay IDs require full refetch after reconnect. Treat persisted entity data as authoritative, not event arrival order. Count and card location update together; active filters continue to apply. A selected task remains open if it moves or no longer matches filters, with a banner explaining that it is outside the current view.

If an update invalidates a drag, abort and show “Task state changed while you were dragging. Review the updated card.” Do not optimistically mark cancellation terminal. On disconnect show “Live updates disconnected. Reconnecting…” and retry at 1, 2, 4, 8, 16, then 30 seconds; refetch board, selected details and active run events on reconnect. While disconnected poll visible lists every 15 seconds; distinguish stale data from run status. Token/duration-only updates must not reorder cards or steal focus. Show duration ticks once per second.

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

KPI fields: count Task.status running and claimed separately; enabled/total Agent.enabled; accounts blocked per usage use case; sum Run.inputTokens/outputTokens/cachedTokens displayed separately. Default interval Today (local midnight to now), alternatives Last 24 hours and Last 7 days. An active run contributes recorded usage, with “Usage may update during the run”. No estimated token counts.

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

Purpose: manage agent identities, provider bindings and the policies governing their execution.

| Name             | Source field                                  | Format                      | Sortable |
| ---------------- | --------------------------------------------- | --------------------------- | -------- |
| Name             | Agent.name                                    | Link                        | Yes      |
| Handle           | Principal.handle                              | agent:<slug>, monospace     | Yes      |
| Role             | Agent.role                                    | Leader / Worker / Reviewer  | Yes      |
| Enabled          | Agent.enabled                                 | Dot + Enabled/Disabled      | Yes      |
| Account          | Agent.accountId -> Account.name               | Link                        | No       |
| Model            | Agent.model                                   | Value or “Provider default” | Yes      |
| Policy / version | Agent.policyId -> Policy.name, currentVersion | Name · vN                   | No       |
| Labels           | Agent.labels                                  | Chips                       | No       |
| Active runs      | count Run.status=running by agentId           | Count                       | No       |
| Updated          | Agent.updatedAt                               | Local timestamp             | Yes      |

Toolbar: Create agent, Refresh, text (name/slug/handle), role, enabled, account, policy and labels. Row actions: Edit, Enable/Disable and Delete. Disabling prevents future starts, does not silently cancel an active run. Delete needs confirmation; on dependency rejection display reason, never cascade/delete history. Leader and reviewer roles are metadata in stage 1; helper text says “Automatic orchestration arrives in a later stage.”

Agent details wireframe expressed as a rendered table:

| Agent name, Enabled dot, Close |                                                                |
| ------------------------------ | -------------------------------------------------------------- |
| Identity                       | Handle, principal ID, slug, role, created by/time              |
| Git identity                   | Author/committer name and email, Copy                          |
| Configuration                  | Account, model, system prompt (collapsed), labels              |
| Current policy                 | Policy link, current vN, mode, workDirs, tools, budgets        |
| Active run                     | Task key, running under policy vM, duration, tokens, Open logs |
| Recent runs                    | Last 10, statuses, historical policy version, View all         |
| Audit history                  | Last 20 matching agent identity, View all                      |
| Sticky footer                  | Edit, Enable/Disable, Delete                                   |

Current policy version is explicitly distinguished from Run.policyVersion. Audit history matches actorId=Agent.id OR targetType=agent and targetId=Agent.id, deduplicated by seq; do not send both as AND. View all preserves the OR intent if the audit endpoint supports it, otherwise offer two separate Actor/Target links.

| Create/edit field  | Validation                                                                                   | Help text                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Name               | Required, trim, 1–120 characters                                                             | “A readable name for this agent.”                                                |
| Slug (create only) | Required, 1–63 lowercase letters/digits/hyphens; starts/ends alphanumeric; unique; immutable | “Creates the stable handle agent:<slug>.”                                        |
| Account            | Required existing Account.id                                                                 | “Runs use this account's shared limits. API accounts cannot execute in stage 1.” |
| Model              | Optional trimmed string, <=200 characters                                                    | “Leave blank for the provider default. Availability is checked by the runner.”   |
| Role               | Required enum; default worker                                                                | “Describes the agent's role; no automatic delegation in stage 1.”                |
| System prompt      | Optional, <=32,000 characters                                                                | “Appended context; never store credentials here.”                                |
| Labels             | Unique trimmed values, each 1–63 characters; max 32                                          | “Tasks can target an eligible agent by label.”                                   |
| Policy             | Required existing Policy.id                                                                  | “New runs evaluate the current policy version.”                                  |
| Enabled            | Boolean, default true                                                                        | “Disabled agents cannot start new runs.”                                         |
| Git name           | Required nonblank <=120; default <name> (agent-band)                                         | “Used as Git author and committer.”                                              |
| Git email          | Required valid email <=254; default <slug>@agents.agent-band.local                           | “Used for attributable commits.”                                                 |

Defaults for Git fields update from name/slug only until the user edits them. Principal.id/handle, createdBy and timestamps are server-generated, not editable. Confirm account/policy changes: “Future runs use the new configuration. Existing runs retain their recorded policy version.” Empty: “No agents yet. Create an agent.” Error: “Could not load agents. Retry.”

## 6. Tasks

Purpose: create work and inspect its lifecycle, assignment, failures and run history.

| Name           | Source field                       | Format                    | Sortable |
| -------------- | ---------------------------------- | ------------------------- | -------- |
| Key            | Task.key                           | Link                      | Yes      |
| Title          | Task.title                         | Text                      | Yes      |
| Status         | Task.status                        | Dot + label               | Yes      |
| Target         | Task.target.agentId or label       | Agent name / Label: value | No       |
| Actual agent   | latest Run.agentId                 | Name / Unassigned         | No       |
| Priority       | Task.priority                      | P0–P3                     | Yes      |
| Work directory | Task.workDir                       | Monospace, full tooltip   | Yes      |
| Created by     | Task.createdBy -> Principal.handle | Handle                    | No       |
| Created        | Task.createdAt                     | Timestamp                 | Yes      |
| Updated        | Task.updatedAt                     | Timestamp                 | Yes      |

Default sort createdAt descending. Toolbar: Create task, Refresh, text key/title, status, target type/value, actual agent, account via run and priority. Details sections: Overview (all Task fields except full prompt), Prompt (escaped multiline), Target and actual assignment, Error/reasons (Task.error), Runs (section 7 table), Audit (target=task/id). Display latest run summary and Open logs; do not conflate task/run status.

| Create field   | Validation                                                                            | Help text                                                                                             |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Title          | Required trimmed 1–200 characters                                                     | “A short description shown on the board.”                                                             |
| Prompt         | Required nonblank, <=64,000 characters                                                | “Instructions passed to the agent.”                                                                   |
| Work directory | Required absolute path; reject relative paths, NUL and unresolved .. segments         | “Must be inside the selected agent's policy work directories. The server performs final path checks.” |
| Target type    | Exactly one: Agent or Label                                                           | “Select one agent or let the dispatcher choose an eligible labeled agent.”                            |
| Agent          | Required if Agent target, existing ID; disabled agents flagged, not silently replaced | “An ineligible agent causes a denied task.”                                                           |
| Label          | Required if Label target, trimmed 1–63 characters                                     | “Matching agents are evaluated individually; denied candidates are skipped.”                          |
| Priority       | Required P0–P3; default P2                                                            | “P0 is highest; equal priorities run in creation order.”                                              |

Key/id/status/actor/timestamps/errors are generated by the server. Clear inactive target fields on target-type switch. Validate directory syntax in UI, but policy normalization and filesystem containment are authoritative on server. Show warning when label currently matches no agents; allow submission since the fleet can change.

No generic task editing endpoint exists in the design. Prompt, target, workDir and title are read-only after creation. Only queued priority change is proposed; cancel action available for queued/claimed/running, no retry/resume in stage 1. Confirmation and pending behavior follow Board. Empty: “No tasks yet. Create your first task.” Error: “Could not load tasks. Retry.” Missing selected item: “This task is no longer available.”

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
| Policy                  | Run.policyId, policyVersion                 | Name · vN     | No                   |
| Worker                  | Run.workerId                                | Monospace ID  | Yes                  |

Default startedAt descending. Toolbar: Refresh, text run ID/task key, status, agent, account, policy, started time range. Details: Context (all identifiers including worker), Lifecycle (status/start/finish/exitCode/error/reset time), Usage (three token counts and optional cost), Policy snapshot (exact version and rules, not current rules), Events (kind filters), Audit (target=run/id plus agent action links). Open logs opens dock. Cancel task routes to the task cancellation action only while Task status allows it; never invent a run-delete endpoint.

No create/edit form: runs are produced by the dispatcher and history is read-only. Event filters cover text/tool/usage/rate_limit/error/stderr/session; within a run, cursor/event-ID paging retains ascending order. Unknown event kinds render a JSON preview rather than dropping data. Empty: “No runs yet. Runs appear when tasks start.” Error: “Could not load runs. Retry.” Log error: “Could not load run events. Retry.” During a terminal run show “Run finished” and keep logs available.

## 8. Policies

Purpose: define permissions and budgets as immutable policy versions.

| Name             | Source field                     | Format               | Sortable                    |
| ---------------- | -------------------------------- | -------------------- | --------------------------- |
| Name             | Policy.name                      | Link                 | Yes                         |
| Version          | Policy.currentVersion            | vN                   | Yes                         |
| Mode             | current PolicyVersion.rules.mode | Label                | No                          |
| Work directories | rules.workDirs                   | Count and first path | No                          |
| Daily budget     | rules.dailyTokenBudget           | Tokens / Not set     | No                          |
| Max duration     | rules.maxRunMinutes              | Minutes / Not set    | No                          |
| Bound agents     | count Agent.policyId             | Count                | No                          |
| Created by / at  | Policy.createdBy, createdAt      | Handle / timestamp   | Yes for time; No for handle |

Toolbar: Create policy, Refresh, text name/description, mode. Details: Metadata; Current rules (all rules fields); Versions newest first with version/createdBy/createdAt; select version for full read-only rules and field-by-field comparison to current; Bound agents; policy.decision audit for this policy if data includes policy ID. Do not infer audit targets from display names.

| Create/new-version field | Validation                                                                              | Help text                                                     |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Name                     | Required trim 1–120 characters                                                          | “Readable policy name.”                                       |
| Description              | Optional <=2,000 characters                                                             | “Explain the intended scope.”                                 |
| Work directories         | Required nonempty array of absolute normalized paths; reject traversal/NUL; deduplicate | “Runs must stay inside one of these roots.”                   |
| Mode                     | Required read-only/edit/full-auto                                                       | “Mapped to provider permissions where supported.”             |
| Allowed tools            | Optional unique trimmed nonblank names                                                  | “Passed to the CLI where supported; not a universal sandbox.” |
| Denied tools             | Optional unique trimmed nonblank names; reject overlap with allowed tools               | “Blocked where the provider supports this option.”            |
| Daily token budget       | Optional positive safe integer                                                          | “Agent daily budget evaluated before a run starts.”           |
| Maximum run minutes      | Optional positive safe integer                                                          | “The run is cancelled after this duration.”                   |
| Allowed accounts         | Optional list of existing IDs                                                           | “Leave unset for no extra account restriction.”               |

Unset allowed/denied tools and allowedAccountIds are omitted, not serialized as ambiguous empty arrays. UI clearing account restriction asks explicit acknowledgement “Allow any bound account”. Review full-auto and scope expansion with a change summary before Save new version. Historical versions cannot be overwritten/deleted. Metadata update semantics are not defined in the source: name/description editable at creation only until an explicit contract exists; New version edits rules only. Empty: “No policies yet. Create a policy before creating an agent.” Error: “Could not load policies. Retry.”

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

Toolbar: Add account, Refresh, text name, provider/type/label. Details: Configuration (id/name/provider/type/configDir/labels/limits/actor/timestamps); Credentials (“Secret configured” boolean only if explicitly provided by a safe endpoint, otherwise “Credential status unavailable”); Latest 5h/weekly snapshots (usedPercent/ts/resetsAt); Availability with every blocking reason; Agents; recent Runs; Audit target account/id. No reveal secret action. Delete disabled during active runs; server rejects dependencies without implicit cascade. Confirmation includes bound-agent count.

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

Never prefill API secret; blank edit preserves it. Render Password input, no credential values in browser storage, analytics, error logs or URL. Config directory is a path, not a credential upload. Clear secret input on success and close. No login/session setup UI is promised; CLI credentials must already be configured locally. Empty: “No accounts yet. Add a provider account.” Error: “Could not load accounts. Retry.”

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

Action options: account.create/update/delete; agent.create/update/delete; policy.create/update; task.create/cancel; policy.decision; run.start/finish; agent.tool_use; run.rate_limited. Unknown action strings remain visible and can be copied. Target type selection does not imply all policy decisions use policy as target; data and API filtering contract are authoritative.

Details: sequence/time, resolved actor with ID/kind/handle, exact action, target type/ID, safely formatted full supplied data, prevHash/hash with Copy, links to related resources only when IDs/types are known. Tool input remains the already-truncated logged value; UI cannot reconstruct original input. No create/edit/delete form or controls.

Chain indicator is independent of list filters:

- “Not verified” initially; “Verifying…” while pending.
- Success “Verified through sequence <N> at <time>”, scoped to the range actually returned by verification.
- Failure “Chain verification failed at sequence <N>” only if the endpoint supplies that sequence; otherwise “Chain verification failed”. Details show supplied mismatch/reason.
- Request failure “Verification unavailable. Retry.” is different from invalid chain.
- New events after verification change indicator to “Verified through <N>; newer events not verified”. A filtered table cannot itself establish full-chain integrity.
- Request full-chain verification by default; never verify only currently loaded rows or label an incomplete range as fully verified.

Export: action exports JSONL using the audit export endpoint, with the current supported filters and a frozen upper-sequence bound if supported. Dialog summarizes filters, scope and “Filtered exports can omit intermediate chain entries; verify against a full export.” Alternative All events exports the full chain. Each line contains complete stored AuditEvent fields, including hashes; secret handling is server-side. Stream download named agent-band-audit-<UTC timestamp>.jsonl, retain no file contents in UI storage. If endpoint cannot honor filters or an export bound, disclose “This export contains all events” or “Events added during export may be included” before starting; never silently ignore scope. Export failure: “Could not export audit events. Retry.” Normal empty: “No audit events recorded yet.” Filter empty: “No audit events match these filters.” Error: “Could not load audit events. Retry.”

## 11. Status vocabulary and keyboard shortcuts

These tables cover every enum named status in the domain model. Principal.kind, Agent.role, Account.provider/type, policy mode, RunEvent.kind and snapshot window are categories, not lifecycle statuses, and use neutral badges.

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
| Outbox (internal, no screen) | publishedAt absent  | Pending publication | --muted    |
| Outbox (internal, no screen) | publishedAt present | Published           | --ok       |

Additional UI indicators: Available --ok; Concurrency full, Budget exhausted, Rate limited --warn; Unknown --muted; live Connected --ok / Reconnecting --warn; verification Valid --ok / Invalid --crit / Not verified or unavailable --muted / newer unverified --warn. Outbox is never exposed as a new UI screen. Account has no stored status field. A denied run does not exist in the model; denial belongs to Task.

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

## 12. Implementation assumptions and contract gaps

The source design is deliberately high-level. The following are explicit proposals rather than existing backend facts:

- Priority: P0–P3 represented by integers 0–3, lower first, default 2; creation order breaks ties. Queue reordering requires a queued-only priority update use case and transactional rejection after claim. Until available, do not offer working reordering. No arbitrary rank or Task.labels is introduced.
- Client string/array limits and positive integer constraints in forms must be mirrored in shared zod contracts. Architect should approve them before implementation; server errors remain authoritative.
- Daily counters use the backend's accounting-day definition. Dashboard interval filtering uses local time, but budget panels must display the accounting timezone returned by the backend; if absent label “Budget day timezone unavailable”. Do not reset budgets in the browser.
- Label targets with no candidate remain queued, pending confirmation of dispatcher behavior. UI warns and displays server status without synthesizing a lifecycle transition.
- Delete dependency rules and task cancellation eligibility must be formalized in use cases; UI takes the conservative rules here and still handles authoritative conflict responses.
- Policy metadata editing, API-secret replacement, credential-configured boolean, audit export filters/snapshot bound, verification range fields and SSE replay IDs need explicit response contracts. Missing capabilities render the stated fallback rather than fictitious success.
- Historical identity joins may expose current names, but IDs and recorded policy versions are definitive. No historical name snapshot is invented.
- Layout, dashboard and agent details wireframes use rendered tables for reviewability. They convey regions and sizing without image assets or new colours.

### Lens patterns

Copy: compact rail plus resource sidebar; dense tables with stable identity columns; selection-driven details; a resizable followable log dock; clear connection state and contextual resource links.

Avoid: terminal-like controls implying unrestricted access; colour-only state; hidden critical columns on narrow windows; auto-scrolling logs while a user reads history; excessive modal navigation; showing stale quota as current capacity; policy controls that imply unsupported provider enforcement.
