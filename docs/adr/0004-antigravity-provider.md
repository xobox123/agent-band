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

## Consequences

- A tampered or removed hook file denies every further tool call instead of silently disabling the policy.
- Two Antigravity runs cannot share a workspace.
- Switching to a hooks path outside the workspace later only changes `registerAgyHook`.
