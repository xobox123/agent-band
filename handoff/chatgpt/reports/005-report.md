# Report 005: Isolated agent profile for Claude Code runs (research)

Status: done

## Summary
Added the "Isolated agent profile" section to [the CLI capability matrix](../../../../docs/research/cli-capability-matrix.md), covering Claude Code, Codex CLI and Antigravity CLI. The key finding is that `--bare` provides excellent context isolation but deliberately **does not read subscription OAuth**; it is not suitable for the existing agent-band account login. A source-selection approach that keeps the account's original credential namespace and controls settings/plugins/MCP per run is the candidate pending CLI and OS-specific tests.

## Done
- Reviewed the existing [Claude adapter](https://github.com/xobox123/agent-band/blob/main/apps/server/src/runner/adapters.ts), [process spawn](https://github.com/xobox123/agent-band/blob/main/apps/server/src/runner/process.ts), account probing and task 003 matrix.
- Compared `--setting-sources`, `--settings`, `--strict-mcp-config`, `--plugin-dir`, `CLAUDE_CONFIG_DIR`, `--bare`, `--safe-mode` and related restrictions, including what is excluded and residual limitations. Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference), [headless/bare mode](https://code.claude.com/docs/en/headless), [settings](https://code.claude.com/docs/en/settings).
- Documented macOS Keychain namespaces and Linux credential-file behavior without proposing token copying; documented implicit API key priority over a subscription in print mode. Sources: [authentication](https://code.claude.com/docs/en/authentication), [environment variables](https://code.claude.com/docs/en/env-vars).
- Described how to inject only band-selected skills and hooks through a temporary plugin, and an explicit MCP config with strict mode. Sources: [plugin reference](https://code.claude.com/docs/en/plugins-reference), [MCP](https://code.claude.com/docs/en/mcp).
- Covered comparable gaps for [Codex](https://developers.openai.com/codex/config-advanced) and [Antigravity](https://www.agy.dev/docs/cli/headless/) and a controlled A/B measurement plan.

## Not done (and why)
- No real CLI, test suite, macOS Keychain or Linux credential smoke test was run. The handoff protocol explicitly does not permit running the project test suite, and no connected account binary/credentials are available for OS testing.
- No token saving percentage can be claimed. The task describes about 240k cached tokens per run, not a measured reduction from this proposal.
- No runner changes were made, because the deliverables were docs and research only.

## Assumptions
- A production runner can retain the **already logged-in** account config directory and avoid overriding `CLAUDE_CONFIG_DIR` for the default account.
- Passing `--setting-sources ""` is accepted by the pinned Claude Code build. It appears in real-world reports, but the [official CLI reference](https://code.claude.com/docs/en/cli-reference) does not specify the empty-string value; validate against the installed binary before implementing.
- Managed settings cannot be removed by a normal CLI invocation. The app must respect administrator-enforced policy.

## Questions for the architect
- Is the product requirement strict *zero* non-band customizations or only measurable context reduction? These differ when enterprise-managed rules apply.
- Is creating a separately authenticated worker account/home acceptable if a future CLI version breaks the empty-source approach?
- Should resuming existing runs across a profile migration be disabled until tested?

## Suggested next tasks
- Implement an isolated Claude launch profile behind a feature flag, preserving the current per-account auth path and passing a tightly controlled `--settings`, plugin bundle and MCP JSON.
- Implement a release-pinned two-OS smoke-test matrix for hostile user/repo settings and benign band-provided hooks, skills and MCP, plus session resume.
- Instrument `system/init` inspection and A/B token/latency measurements. Fail closed on unexpected discovered configuration.

## Recommended design (half-page)

**Use "account auth identity" and "run customization" as two separate planes.** The account record owns the same existing `CLAUDE_CONFIG_DIR` it used for interactive `claude auth login` (or leaves it absent for `~/.claude`). The runner must not inspect, copy or rewrite credentials. Before launching, verify `claude auth status` under exactly that environment and reject an unexpected `configDirectory` or unauthenticated state. Drop stray API-key/auth override variables from the inherited environment when the account's configured provider is the Claude subscription. This preserves macOS Keychain namespacing and Linux file-backed auth without a new login. [Authentication](https://code.claude.com/docs/en/authentication), [environment](https://code.claude.com/docs/en/env-vars).

**For every run**, create a permission-restricted temporary profile bundle outside the untrusted worktree: `settings.json` (permission/sandbox settings plus band-only hooks if needed), `plugin/` (exact approved skills, hook scripts and manifest), and `mcp.json` (only band's delegation endpoint). Launch `claude -p --output-format stream-json --verbose --setting-sources "" --settings <bundle>/settings.json --plugin-dir <bundle>/plugin --mcp-config <bundle>/mcp.json --strict-mcp-config`, preserving today's per-run tool policy and appending the band system prompt. Never choose `--bare` for a subscription OAuth account, since it bypasses OAuth entirely. Avoid `--safe-mode` for normal runs because its purpose is disabling customization, including the band's own capabilities. [Headless](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference).

**Release gate:** pin a Claude binary version, test empty-source acceptance on macOS/Linux and both default/custom account paths, seed hostile user/project/ancestor skills/hooks/MCP/memory, and positively verify only band's selected hooks/skills/MCP load and execute. Inspect `system/init`, trace hooks and deliberately test resume. Collect a matched baseline/isolated sample of input/cache-read/cache-write tokens and startup time, reporting median/p95 with correct cache accounting. A validation failure must disable the feature flag or reject the run, not silently inherit personal settings. This design is **proposed, not tested**. [Headless init and usage](https://code.claude.com/docs/en/headless), [cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
