# agent-band: agent chat, agent memory, memory to skills

Date: 2026-10-07. Product owner: "I pick an agent, click Chat and talk to it,
tell it how to work; it should be saved so agents have their own context;
possibly move it into skills."

Depends on the conversation infrastructure from
`2026-10-07-approvals-conversation.md` (continuation runs with session
resume, chat composer, dictation button).

## 1. Agent chat (not bound to a task)

- `Conversation` (new module `conversations`): id, orgId, agentId, title
  (auto from the first message, editable), status active | archived,
  sessionId (provider session for resume), createdBy, timestamps.
  `ConversationMessage`: id, conversationId, role user | agent | system,
  text, runId?, createdAt.
- Sending a message queues a run of kind `chat` on that agent in the agent's
  home folder `<workspaceRoot>/agents/<slug>` (created on demand), with the
  agent's policy, skills, memory and approvals as usual; the run resumes the
  conversation session (Claude `--resume`, Codex thread context). Agent text
  events become agent messages streamed live over SSE.
- Chat runs do not appear on the Board (they appear in Runs with kind chat)
  and respect account limits, reserve thresholds and pause.
- Actions on a message: "Create task from this" (prefills New task with the
  message or selection), "Create goal", "Remember" (adds to memory).
- UI: Agents screen -> agent -> Chat tab: conversation list on the left,
  chat on the right, composer with dictation, typing/working indicator,
  tool activity collapsed, approvals inline.

## 2. Agent memory

- `AgentMemory`: id, orgId, agentId, text (max 2 KB), kind
  instruction | fact | preference, source manual | chat | task | agent,
  sourceRef?, status active | proposed | archived, createdBy, timestamps.
- Every run of the agent gets the active memory appended to its system
  prompt under "What you know from previous work" (newest first, total cap
  8 KB, then truncated with a note); the run records the memory ids/hash it
  used.
- MCP tool `remember({ text, kind })` for all runs: creates a `proposed`
  entry; the human accepts/edits/rejects it in the agent's Memory tab or the
  "Needs you" inbox (org setting: auto-accept agent memories, default off).
- Memory tab: list with filters, edit, archive, reorder priority; audit
  `memory.create|update|archive|accept|reject`.
- Group/org memory is out of scope (skills cover shared knowledge).

## 3. Memory and chats to skills

- "Create skill" from selected memory entries or a conversation: queues a
  short run of the same agent (or a chosen writer agent) in read-only mode
  with instructions to produce a SKILL.md (name, description, when to use,
  steps) from the material; the draft opens in an editor (markdown with
  preview); on save it is imported into the skills library (new skill or new
  version of a chosen skill) and can be assigned to the agent, a group or
  the org in the same dialog. Optionally archive the source memory entries.
- Audit `skill.import` with source refs.

## Tests

Conversation lifecycle and resume args, chat runs excluded from Board,
limits respected, memory injection with cap and run recording, remember tool
-> proposed -> accept, create-task-from-message, skill draft flow (scripted
adapter) and import, UI chat/memory/skill dialog, e2e: send a chat message
and see the reply (scripted adapter or API seeding).
