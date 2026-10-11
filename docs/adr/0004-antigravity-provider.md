# 0004: Antigravity CLI provider and Gemini CLI limited to API keys

## Context

Google stopped serving Gemini CLI for Google AI Pro/Ultra and Code Assist for individuals (`IneligibleTierError UNSUPPORTED_CLIENT`, "migrate to the Antigravity suite"). The successor is the Antigravity CLI `agy`, which logs in with OAuth and keeps its credentials in the OS keyring.

## Decision

- Gemini CLI accounts support API key and Vertex only. Consumer plan login through Gemini CLI is removed on purpose (owner decision); existing plan-login Gemini accounts must be replaced by an `antigravity` account.
- The `antigravity` provider (harness `antigravity-cli`) runs `agy` headless with `--output-format stream-json`. `agy` has no config-dir variable, so every run uses the machine's one default login.
- Tool policy is enforced by a PreToolUse hook. `agy` has no setting for a hooks path outside the workspace, so the adapter writes `<workDir>/.agents/hooks.json` for the run only:
  - the file is read-only, excluded through `.git/info/exclude` and removed (the previous content restored) when the run ends, also after a failed spawn or a cancel;
  - a run refuses to start when the repository tracks that file or when another run uses the same workspace; a leftover entry of a crashed run (its script is gone) is removed first;
  - the hook script lives in the run dir and checks the sha256 of the file (kept outside the workspace) before every decision, denies when it differs, and denies writes, edits and shell commands that touch `.agents`.

- Headless `agy` cannot prompt, so under `--mode accept-edits` it auto-denies every shell command. Its allow rules live in the global `settings.json` (no per-run path), which runs must not touch. An `edit` run with the hook therefore passes `--dangerously-skip-permissions`; verified: the PreToolUse hook still enforces its deny under that flag. The policy then acts as the permission prompt: the run's policy snapshot lists `requirePreApproved` tools (`Bash`, `WebFetch`, `WebSearch`), which `decideTool` denies server-side unless a pre-approved rule or preset covers the call, so the run log and audit show the real decision. Such denials, like agy's own `denied_actions`, make an unchanged edit run end `failed` instead of `done`. Everything else follows the normal policy, and unjudgeable tools stay denied. Details in `docs/research/cli-capability-matrix.md`.
- A run that reports denied tools (agy `denied_actions`, Claude `permission_denials`, Codex declined items) and changed no files ends `failed` with `tools were denied: <list>` instead of `done`, and its checks do not run.

## Consequences

- A tampered or removed hook file denies every further tool call instead of silently disabling the policy.
- Two Antigravity runs cannot share a workspace.
- Switching to a hooks path outside the workspace later only changes `registerAgyHook`.
