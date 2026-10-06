# 003: CLI capability and enforcement matrix (research)

## Read first
- `docs/superpowers/specs/2026-10-06-agent-band-design.md` sections "Runner and provider adapters", "Providers (extensible)", "Skills", "Research-driven decisions"
- `handoff/chatgpt/README.md`

## Architect note on 002
Accepted and merged. Answers to your questions are in the spec section "Decisions from UI review 2".

## Goal
We need facts, from official documentation and source code, about what each
agent CLI can enforce and how we control it non-interactively. The worker
(next implementation wave) is built on this.

## Deliverable
`docs/research/cli-capability-matrix.md` (English), one section per CLI:
Claude Code CLI, OpenAI Codex CLI, Google Gemini CLI. For each, with links
to the exact documentation page or source file and the CLI version the
statement applies to:

1. Non-interactive invocation and machine-readable output (flags, event
   format, where usage/tokens and rate-limit information appear).
2. Config isolation per account (env var or flag for the config/home dir;
   what lives there: auth, settings, sessions). Can two accounts run in
   parallel on one machine?
3. Permission/sandbox controls (modes, allow/deny tool lists, filesystem
   and network sandbox), and which are enforced by the CLI vs advisory.
4. Hooks: is there a pre-tool-use hook that can allow/deny a tool call?
   How is it configured per run without modifying the user's own config
   (e.g. plugin dir, extra settings file, CLI flag)? Timeout and failure
   behaviour (fail open or closed?).
5. Skills/plugins/extensions: how to load a set of skills for one run only.
6. Custom model providers (OpenAI-compatible base URL, API key env var,
   chat vs responses wire API) for Codex; equivalent options for the others.
7. Identity: how to read the signed-in account identity (email/org)
   non-interactively, if at all.
8. Known breaking changes between recent versions (e.g. Codex removed
   `--full-auto` in 0.160).

End with a matrix table: rows = our policy rules (workDirs, maxMode,
allowedTools, deniedTools, maxRunMinutes, allowedSkillIds, network),
columns = CLIs, cells = "enforced by CLI", "enforceable via hook",
"admission only", or "not possible", each with a footnote link.

Mark anything you could not verify as "unverified".

## Out of scope
Code. Files other than the deliverable and your report.

## Report
`handoff/chatgpt/reports/003-report.md` per the template in the README.
