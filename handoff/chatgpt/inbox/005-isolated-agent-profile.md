# 005: Isolated agent profile for Claude Code runs (research)

Board task: AB-15. Write in English.

## Read first
- `docs/research/cli-capability-matrix.md` (your earlier work, task 003)
- `apps/server/src/runner/` (how Claude Code is spawned today)
- `handoff/chatgpt/README.md`

## Problem
agent-band runs `claude -p --output-format stream-json` with the account's
config dir. Claude Code then loads the user's own hooks, skills, plugins and
CLAUDE.md files, which costs about 240k cached tokens per run and makes runs
depend on the user's personal setup.

## Goal
Find, from official documentation and Claude Code source/changelog, how to
run Claude Code headless with a minimal, controlled settings layer while
keeping the account login. Use current versions and link every claim.

## Questions
1. Which flags or settings exclude user-level settings, hooks, plugins,
   skills, memory files and MCP servers (`--setting-sources`,
   `--strict-mcp-config`, `--settings`, `CLAUDE_CONFIG_DIR`, others)? What
   exactly does each one disable?
2. How does the login (OAuth/keychain) interact with `CLAUDE_CONFIG_DIR` on
   macOS and Linux? Can we isolate settings without a new login?
3. How to still pass agent-band's own skills, hooks and MCP servers per run.
4. Measured or documented effect on tokens per run, if available.
5. Same questions, briefly, for Codex CLI (`codex exec`) and Antigravity
   (`agy`).

## Deliverables
- New section "Isolated agent profile" in `docs/research/cli-capability-matrix.md`.
- A recommended design (half a page) at the end of the report:
  `handoff/chatgpt/reports/005-report.md`.
