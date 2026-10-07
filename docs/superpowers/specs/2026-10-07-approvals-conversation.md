# agent-band: live approvals and conversation with agents

Date: 2026-10-07. Found in production use: a Claude agent in `edit` mode
needed WebFetch and `curl`; headless Claude auto-denied them, the agent asked
"should I retry?" and the task ended `done` although it was waiting for a
human.

## 1. Live permission approvals

- Claude runs get `--permission-prompt-tool mcp__agent_band__approve`
  (attached through the per-run `--mcp-config` already used for leaders, now
  for every Claude run). When Claude would ask a human for permission, it
  calls our MCP tool with the tool name and input.
- The server first evaluates the effective policy: explicitly denied ->
  deny; explicitly allowed (allowedTools / permission presets) -> allow;
  otherwise create an `Approval` { id, runId, taskId, agentId, toolName,
  input, status: pending | allowed | denied | expired, decidedBy, scope:
  once | always } and keep the MCP call open (long poll, up to the run's
  approval timeout, default 30 min, configurable per policy
  `approvalTimeoutMinutes`; on timeout -> deny with reason).
- Task gets status `awaiting_approval` while an approval is pending (Board
  column "Needs you", shared with item 2). SSE `approval.created/decided`.
- UI: "Needs you" inbox (header badge with count), approval cards on the
  Board and in task details: tool, readable input (URL, command), agent,
  policy context; buttons Allow once / Always allow (adds a rule to the
  agent's policy as a new version, audited) / Deny (with optional reason).
- Codex: equivalent when its non-interactive approval routing supports it
  (see matrix); otherwise rules only.
- Audit: `approval.request`, `approval.decide` (human actor), policy version
  created by "always allow".

## 2. Conversation (agent asks, human answers)

- New MCP tool `ask_human({ question, options? })` available to every run
  (described in the appended system prompt: use it instead of ending the
  turn with a question). The run ends its turn; the task goes to
  `awaiting_input` with the question; Board column "Needs you".
- Heuristic fallback for agents that just end with a question: if the final
  assistant text ends with a question mark and the run made no file changes,
  mark `awaiting_input` too (configurable, default on).
- Human replies in the task panel (thread view of the conversation:
  prompt, agent messages, questions, answers). Reply queues a continuation
  run on the same agent that resumes the Claude session (`--resume`) or, for
  Codex, carries the thread as context. Optional quick buttons from
  `options`.
- `task.reply` audited; replies are part of the task history.

## 3. Permission presets in policies

Named presets that expand to provider tool rules, editable in the policy
form as checkboxes: "Web read" (WebSearch, WebFetch), "Shell: git", "Shell:
npm/node", "Shell: any" (warning), "Network via curl" (Bash(curl:*)), "Edit
files". Stored as `presets: string[]` in PolicyRules (merge: intersection)
and expanded at run start into allowedTools for Claude and sandbox/network
settings for Codex (`-c sandbox_workspace_write.network_access=true` when a
network preset is allowed).

## Tests

MCP approve tool flow (allow by policy, deny by policy, pending -> human
allow once/always/deny, timeout), task status transitions, Board "Needs you"
column, reply continuation with resume, ask_human, presets expansion per
provider, audit actors.
