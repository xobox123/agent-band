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

## Architect note (rework 1, PR #6)

Review of PR #6 requested changes. Fix every finding below, merge the latest main into your branch, push and wait for green CI, then mark the PR ready again.


This PR only touches docs: a new "Isolated agent profile" section in `docs/research/cli-capability-matrix.md` and `handoff/chatgpt/reports/005-report.md`. Every deliverable exists and all five questions get an answer. Claims are linked and honestly marked as untested. What the doc says about agent-band's own code is accurate: the Claude adapter already passes `--plugin-dir`, `--mcp-config` and `--strict-mcp-config` (`apps/server/src/runner/adapters.ts:73-79`), `runEnv` leaves the default `CLAUDE_CONFIG_DIR` unset (`adapters.ts:34-46`), and `agy` registers its hook in `.agents/hooks.json` (`agy-hook.ts:35-36`). There are no em dashes, and the prettier-ignore block is fine.

I checked the CLI claims against the local `claude --help`. That turned up one flag the research misses that bears directly on Q1, plus a few smaller inaccuracies. No code, migrations, contracts or UI changed, so those checks don't apply.

Findings (severity | file:line | issue | fix):

- **Medium** | `docs/research/cli-capability-matrix.md:382-390` | Q1 asks for every flag that excludes user-level settings, and the table leaves out `--restricted`. The current CLI documents that it "ignores user, project and local settings files (managed settings and `--settings` still apply; add `--strict-mcp-config` to skip MCP servers too)". It also removes Bash/code-running tools unless `--tools` names them, confines file tools to the working dirs and refuses `bypassPermissions`. It is the only documented way to drop user, project and local settings without relying on the undocumented `--setting-sources ""`. | Add a `--restricted` row covering what it disables and why it can't be the default (no Bash, no `full-auto`). Add a line to the recommended design saying when it would fit, e.g. `read-only` runs.
- **Low** | `docs/research/cli-capability-matrix.md:388` | The `--bare` row says it "skips ... skills". `claude --help` says "Skills still resolve via /skill-name"; what it actually skips is hooks, plugin sync, auto-memory, keychain reads and CLAUDE.md auto-discovery. | Fix the wording.
- **Low** | `docs/research/cli-capability-matrix.md:378` | The task says to use current versions, but the section never records which Claude Code version the claims were checked against, even though it warns about version-specific behaviour (v2.1.69, v2.1.211, v2.1.268). | State the CLI version and docs date the research is based on.
- **Low** | `docs/research/cli-capability-matrix.md:409` (token effect, Q4) | Q4 is about cutting tokens per run, but the section doesn't mention `--exclude-dynamic-system-prompt-sections`. The CLI documents it as improving prompt-cache reuse across users. It also doesn't mention that `--system-prompt-snapshot` (on by default) freezes the system prompt on resume. That bears on the doc's own resume caveat at `:403`. | Mention both in the token and resume notes.
- **Low** | `handoff/chatgpt/reports/005-report.md:6` | The link `../../../../docs/research/cli-capability-matrix.md` has one `../` too many and points outside the repo. Report 003 uses `../../../docs/...`. | Change it to `../../../docs/research/cli-capability-matrix.md`.
- **Nit** | `handoff/chatgpt/reports/005-report.md:37` | The design runs `claude auth status` before every run. That adds a CLI process per run and the cost isn't discussed. | Suggest caching the result per account, or running it only at account probe time (`probe.ts`).

Everything else is sound:
- The recommended design keeps the existing per-ac
