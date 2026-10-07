# CLI capability and enforcement matrix

Research date: 2026-10-06. Scope: the agent-band runner, provider, skills and runtime-policy decisions in the [design specification](../superpowers/specs/2026-10-06-agent-band-design.md). This is research, not an implementation or a successful real-account smoke test.

## Evidence and version boundaries

| CLI           | Baseline                                                                   | Evidence                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code   | [2.1.292](https://github.com/anthropics/claude-code/releases/tag/v2.1.292) | Official documentation read on the research date and published release notes. The CLI implementation is not available in the public repository; exact binary behavior is **unverified**. |
| OpenAI Codex  | [0.160.1](https://github.com/openai/codex/releases/tag/rust-v0.160.1)      | Official docs plus source pinned to `rust-v0.160.1`.                                                                                                                                     |
| Google Gemini | [0.62.0](https://github.com/google-gemini/gemini-cli/releases/tag/v0.62.0) | Official docs plus source pinned to `v0.62.0`.                                                                                                                                           |

Unless a narrower version is stated, each CLI section uses this baseline. **Source-verified** means inspected implementation at the pinned tag; **docs-verified** means a documented contract, not an executed test. **Inference** identifies adapter recommendations. **Unverified** identifies missing evidence, conflicting documentation or runtime behavior not exercised. Live documentation can move independently of a release.

A working directory is not a filesystem jail. Tool permission checks, process sandboxing, admission checks and prompt instructions are different controls. A shell tool allowed by name can execute many operations. A hook cannot guarantee an OS boundary when some tools bypass it or hook failure produces no denial.

## Claude Code CLI

### 1. Non-interactive execution and telemetry

Docs-verified invocation:

```sh
claude -p "TASK" --output-format stream-json --verbose
```

JSON and JSONL are available, with optional partial messages. Startup-hook events may precede initialization. Sources: [CLI flags](https://code.claude.com/docs/en/cli-reference), [headless output](https://code.claude.com/docs/en/headless), [streaming event types](https://code.claude.com/docs/en/agent-sdk/streaming-output).

For whole-run accounting, the result's `total_cost_usd` covers the full agent tree, whereas result `usage` covers the main loop; per-model `modelUsage`/`model_usage` includes subagents. Costs are client estimates, and resumed-session cost can include earlier work. Assistant blocks can share a message ID and must not be counted repeatedly. Therefore the design's “only final result” rule needs explicit field selection and resume semantics. Source: [cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

Rate limiting is documented as an assistant error, including `rate_limit`. The proposed `rate_limit_event` reset-window schema and guaranteed non-interactive availability are **unverified** here. Do not derive a five-hour or weekly reset from a generic error or hard-code reset timestamps. Source: [headless errors](https://code.claude.com/docs/en/headless). Capture sanitized fixtures for the installed version before declaring `limitWindows` supported.

### 2. Account and config isolation

`CLAUDE_CONFIG_DIR` replaces the usual `~/.claude` directory for settings, sessions and plugins. On Linux credentials are in that directory's `.credentials.json`; on macOS the documented Keychain namespace also depends on the config directory, with file fallback. Separate config directories support distinct account logins. Parallel execution is a documented isolation pattern; a two-account smoke test on each target OS is **unverified**. Sources: [environment variables](https://code.claude.com/docs/en/env-vars), [authentication storage and account isolation](https://code.claude.com/docs/en/authentication).

This does not by itself exclude repository configuration, skills or enterprise-managed policy. `--setting-sources` selects user/project/local settings sources; `--settings` adds a per-session file or JSON object. Settings lists may merge, rather than replace previous lists. Use controlled sources and inspect effective configuration instead of assuming one temporary file resets every setting. Source: [settings precedence](https://code.claude.com/docs/en/settings).

The runner must not copy, decode or read session credentials. Login remains the provider's own flow; directory isolation is not permission to inspect credential contents.

### 3. Modes, tools and sandbox

Documented modes include `default`, `acceptEdits`, `plan`, `auto`, `dontAsk` and `bypassPermissions`. These govern permission decisions, not a universal process sandbox. `plan` still permits some read-oriented shell operations. `dontAsk` rejects requests needing user approval and can use explicitly preapproved tools. Source: [permissions](https://code.claude.com/docs/en/permissions).

`--allowedTools` preapproves, rather than excludes unmatched calls. `--tools` limits built-ins; separately deny MCP via `--disallowedTools`. EndConversation is exceptional. `--restricted` constrains built-in file access and removes shell/code/WebFetch unless enabled. Source: [CLI reference](https://code.claude.com/docs/en/cli-reference).

For shell subprocesses, the native sandbox supplies filesystem/network restrictions on supported platforms (Linux bubblewrap, macOS sandbox-exec). Configure `sandbox.enabled`, `failIfUnavailable: true` and `allowUnsandboxedCommands: false`; review excluded commands and read/write rules. Default read access is broader than the current directory. Hook commands are outside this sandbox, and native Windows support is not equivalent. Source: [sandboxing](https://code.claude.com/docs/en/sandboxing).

**Inference:** implement read-only/edit as both a tool policy and a suitable sandbox, not merely `plan`/`acceptEdits`. Reject unsupported platform/configuration combinations at admission. “Full-auto” is an agent-band label, not a promise that bypassing permission prompts creates any confinement.

### 4. Pre-tool hooks and failure semantics

`PreToolUse` can deny a call with exit code 2 and a reason on stderr, or a successful JSON response:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Policy service unavailable"
  }
}
```

Inject `hooks/hooks.json` in a generated plugin loaded with `--plugin-dir`, or use per-session `--settings`. No write to the user's settings is required. Hook coverage excludes `EndConversation`; other customization mechanisms must also be controlled. Sources: [hook protocol](https://code.claude.com/docs/en/hooks), [plugin layout](https://code.claude.com/docs/en/plugins-reference).

Command hooks default to 600 seconds. Timeout, missing executable, malformed successful JSON or ordinary nonzero error generally produces no blocking decision: **fail open relative to the custom authorization service**, followed by the CLI's normal permission flow. HTTP connection/non-2xx failure likewise does not constitute a denial. Since 2.1.214, exit 2 still blocks even with malformed JSON; earlier behavior differed. The SDK's callback failure rules must not be substituted for CLI command-hook behavior. Source: [hook exit codes, timeouts and errors](https://code.claude.com/docs/en/hooks).

**Inference:** a local hook wrapper must catch API/network/parse failures and return a valid explicit denial before the CLI timeout. This reduces application failures but cannot make a crashed or never-started hook fail closed. Avoid untrusted mods: documented `tool.check` customization can override some nonmanaged hook/permission outcomes. Source: [permission customization](https://code.claude.com/docs/en/permissions).

### 5. Per-run skills and plugins

`--plugin-dir /temporary/run/plugin` loads a local plugin for the session. Put the optional manifest at `.claude-plugin/plugin.json`, and `skills/` and `hooks/` at the plugin root. This fits agent-band's temporary bundle without installing a plugin in the user's profile. Source: [plugin reference](https://code.claude.com/docs/en/plugins-reference).

Adding that plugin does not remove personal, project, managed or other plugin skills. Skill activation permissions and overrides can limit availability; disabling automatic invocation alone does not prevent explicit invocation. Native names are not agent-band immutable Skill IDs or content hashes. **Inference:** select IDs and hash bundles before launch, suppress other discovery sources, and record the effective discovered set. Exclusive loading of exactly the selected bundles in all configurations is **unverified**. Source: [skill discovery and invocation controls](https://code.claude.com/docs/en/skills).

### 6. Custom providers

`ANTHROPIC_BASE_URL` supports a custom gateway endpoint, with provider-supported authentication variables such as `ANTHROPIC_API_KEY`. The gateway must implement the Anthropic-compatible protocol expected by Claude Code. OpenAI Chat Completions and Responses endpoints are not interchangeable with that protocol. Bedrock/Vertex routes have their own documented configuration. Sources: [environment variables](https://code.claude.com/docs/en/env-vars), [LLM gateway requirements](https://code.claude.com/docs/en/llm-gateway), [model configuration](https://code.claude.com/docs/en/model-config). Direct arbitrary OpenAI-only endpoints are **unverified** and must not be advertised as supported.

### 7. Non-interactive identity

`claude auth status` defaults to JSON; `--text` changes presentation. Auth method and config-directory metadata are documented, but a stable email/org schema is **unverified**. Interactive `/status` does not replace a metadata API. Sources: [auth subcommands](https://code.claude.com/docs/en/cli-reference), [authentication](https://code.claude.com/docs/en/authentication). Never decode session tokens for identity.

### 8. Recent changes

Documented additions: restricted mode (2.1.248), auth config-directory reporting (2.1.268), directory plugins (2.1.265). Hook exit-2 behavior changed in 2.1.214. Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference), [hooks](https://code.claude.com/docs/en/hooks). The [2.1.292 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.292) fixes permission/sandbox edge cases and changes one-shot background-task completion timing. Revalidate event termination and permissions after upgrades; earlier versions must not inherit the baseline's guarantees.

## OpenAI Codex CLI

### 1. Non-interactive execution and telemetry

Source-verified invocation:

```sh
codex exec --json -s workspace-write -c 'approval_policy="never"' -C /work/repo "TASK"
```

Use `--skip-git-repo-check` only when the runner intentionally permits a non-Git directory. `--ephemeral` prevents persisted rollout history. Sources: [exec arguments](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/cli.rs), [shared options](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/shared_options.rs).

JSONL has `thread.started`, `turn.started`, `item.*`, `turn.completed`, `turn.failed` and `error`. Completed-turn usage exposes input, cached input, cache-write input, output and reasoning-output token fields. The processor derives this from total thread usage, so do not blindly sum successive cumulative/resumed totals. Sources: [event schema](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/exec_events.rs), [JSONL processor](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/event_processor_with_jsonl_output.rs).

There is no rate-limit snapshot event in that exec JSONL schema. The official app-server offers `account/rateLimits/read` and updates; its windows contain `usedPercent`, nullable `windowDurationMins` and nullable `resetsAt`. Preserve missing fields; do not label every primary window five hours or every secondary window weekly. API-key accounts need not have ChatGPT subscription windows. Sources: [app-server protocol](https://developers.openai.com/codex/app-server), [snapshot](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server-protocol/schema/typescript/v2/RateLimitSnapshot.ts), [window schema](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server-protocol/schema/typescript/v2/RateLimitWindow.ts).

The design's post-run rollout parsing is an internal-format dependency, not the stable exec output contract. Match the emitted thread ID and handle missing files/`--ephemeral`; never select the newest file across concurrent runs. Presence of a complete rate-limit snapshot in every rollout is **unverified**. Source: [rollout recorder](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/rollout/src/recorder.rs).

### 2. Account and config isolation

`CODEX_HOME` relocates configuration, file-backed auth, history, logs and session state. Credentials may instead use OS credential storage. Separate directories are an **inferred** basis for concurrent accounts, not proof that every keychain backend is independently namespaced. Confirm the selected storage backend on each OS without reading credentials. Source: [advanced config and CODEX_HOME](https://developers.openai.com/codex/config-advanced).

Project config, skill roots and managed settings remain separate sources. A temporary config override is not a complete isolation boundary. The baseline shared-options code also describes named profiles as `CODEX_HOME/<name>.config.toml`; do not assume older inline profile recipes apply. Source: [profile and CLI overrides](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/shared_options.rs). Actual simultaneous two-account login/execution is **unverified**.

### 3. Permissions and sandbox

Sandbox choices are `read-only`, `workspace-write` and `danger-full-access`. Use per-run `-s` and configuration overrides, with `approval_policy="never"` for deterministic headless refusal instead of permission escalation. `--dangerously-bypass-approvals-and-sandbox` deliberately removes both controls. `--approve-for-me` uses automatic approval review and is not equivalent to a strict allowlist. Source: [shared CLI options](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/shared_options.rs).

Workspace-write restricts writes and defaults network access off; it does not imply read access only inside the workspace. Configure writable roots and temporary-directory behavior explicitly. More granular filesystem policy exists in the source, but an agent-band strict read-root configuration is **unverified**. Sources: [sandbox configuration](https://developers.openai.com/codex/config-advanced), [filesystem permission policy](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/protocol/src/permissions.rs).

Linux's implementation uses bubblewrap mounts and network filtering. WSL2 and WSL1 differ; unsupported or insufficient sandbox implementations must not silently be treated as confinement. Source: [Linux sandbox implementation notes](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/linux-sandbox/README.md). Platform-specific runtime enforcement is **unverified** until tested.

A generic CLI `--allowedTools`/`--deniedTools` pair for all tool categories was not verified. Use hook decisions for covered tools, with explicit coverage limitations below. Prompt instructions are advisory.

### 4. Pre-tool hooks and failure semantics

`PreToolUse` covers participating local tools, including shell, patch and MCP. Hosted web search, follow-up write_stdin and opted-out tools lack equivalent gating. Source: [official hook coverage](https://developers.openai.com/codex/hooks).

Per-run `-c` hook configuration merges with discovered files. Nonmanaged hooks need trust; `--dangerously-bypass-hook-trust` is appropriate only for runner-vetted hooks and does not bypass tool permissions. Source: [hook configuration and trust](https://developers.openai.com/codex/hooks).

A successful JSON denial uses the Claude-shaped `hookSpecificOutput.permissionDecision="deny"`. Exit 2 blocks only with a nonempty stderr reason and a handler permitted to control the operation. Plain `allow` without `updatedInput` is not a supported unconditional approval response in this implementation. Return ordinary success/no denial to continue normal policy, rather than manufacturing an unsupported approval. Source: [PreToolUse processing and tests](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/hooks/src/events/pre_tool_use.rs).

Default timeout is 600 seconds; command execution applies the configured timeout. Timeout, launch failure, malformed JSON and ordinary error produce no custom block: **fail open relative to the hook gate**. Sources: [hook docs](https://developers.openai.com/codex/hooks), [command runner](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/hooks/src/engine/command_runner.rs). A deny-on-service-error wrapper is necessary but cannot close CLI-level hook crashes or uncovered tool paths.

### 5. Per-run skills

Skills are discovered from user, repository, system/bundled and plugin roots. `skills.config` entries disable or enable discovered paths/names; they are not a general “load only this new directory” flag. Source: [skills documentation](https://developers.openai.com/codex/skills), [skills configuration types](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/config/src/skills_config.rs).

`CODEX_HOME` alone does not isolate `~/.agents/skills` or repository `.agents/skills`. The loader discovers independently, and its host code explicitly performs discovery reads before enforcing turn permissions. Sources: [discovery](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/ext/skills/src/loader/discovery.rs), [loader host](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/ext/skills/src/loader/host.rs).

**Inference:** create a controlled per-run home/worktree or disable every nonselected discovered skill, including bundled ones, and validate the resulting set. No equivalent to Claude's one-session arbitrary `--plugin-dir` was verified. The exact native layout and exclusive loading procedure remain **unverified**; write an ADR after a local smoke test rather than promising isolation from config-directory relocation.

### 6. Custom model providers

The pinned provider type supports `base_url`, an `env_key` naming the secret environment variable, and Responses wire API. A per-run provider can be selected with:

```sh
codex exec --json \
  -c 'model_provider="band_gateway"' \
  -c 'model_providers.band_gateway.name="Band gateway"' \
  -c 'model_providers.band_gateway.base_url="https://gateway.example/v1"' \
  -c 'model_providers.band_gateway.env_key="AGENT_BAND_PROVIDER_KEY"' \
  -c 'model_providers.band_gateway.wire_api="responses"' \
  -m MODEL "TASK"
```

This is a configuration example, not a tested endpoint. Supply the secret through the child environment, never the command line, report or event log. Built-in provider IDs cannot be overwritten arbitrarily. Source: [provider type, serialization and validation](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/model-provider-info/src/lib.rs).

**Source-verified incompatibility:** `wire_api="chat"` is explicitly rejected in 0.160.1. A server supporting only Chat Completions needs a Responses-compatible intermediary or another harness. The design's `wireApi: "chat" | "responses"` form must gate chat-only endpoints for this baseline. Exact removal release is **unverified**; do not claim both wires because older documentation did.

### 7. Non-interactive identity

`codex login status` reports authentication mode as human text on stderr and can display a masked API key. It is not a machine-readable email/org endpoint, and its raw output should not be persisted. Source: [login status implementation](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/cli/src/login.rs).

The official app-server `account/read` provides safe account metadata. The pinned `chatgpt` variant contains nullable email and plan type; API-key and Bedrock variants do not supply an email. No organization/workspace ID is present in this account schema. Sources: [app-server account/read](https://developers.openai.com/codex/app-server), [Account schema](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server-protocol/schema/typescript/v2/Account.ts). Organization identity and complete dedupe semantics are **unverified**. Use the provider's supported metadata protocol, not auth.json or JWT decoding.

### 8. Recent changes and documentation conflict

`--full-auto` is absent from the baseline's shared and exec argument structures. The live [CLI reference](https://developers.openai.com/codex/cli/reference) still describes it as a deprecated compatibility flag. Prefer source-pinned options above. Sources: [shared options](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/shared_options.rs), [exec CLI](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/cli.rs). Absence in 0.160.1 is source-verified; the task's assertion that removal first occurred in 0.160 is **unverified**, since the [0.160.0 release notes](https://github.com/openai/codex/releases/tag/rust-v0.160.0) do not establish that boundary.

Chat wire rejection and profile semantics also require versioned launch configuration. [0.160.1](https://github.com/openai/codex/releases/tag/rust-v0.160.1) fixes preservation of Windows environment overrides for remote MCP; upgrading can affect credential/config propagation. Pin the binary and fixture parser together.

## Google Gemini CLI

### 1. Non-interactive execution and telemetry

```sh
gemini -p "TASK" --output-format stream-json
```

`--output-format json` yields a response, stats and optional error; stream-json emits `init`, `message`, `tool_use`, `tool_result`, `error` and `result` JSONL events. Final stats expose token/usage data; single-JSON stats include model-level metrics. Do not mistake streamed text for a usage delta. Documented exit codes include 0 success, 1 general failure, 42 invalid input and 53 turn limit. Sources: [pinned headless guide](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/headless.md), [non-interactive event emitter](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/nonInteractiveCli.ts).

A guaranteed account-level rate-limit event with quota percentages and reset windows is **unverified**. Treat API failures separately from known reset snapshots; do not infer the Claude/Codex subscription windows. Parsers need recordings from the installed version.

### 2. Account and config isolation

Source-verified `GEMINI_CLI_HOME` overrides the home root. Data lives under `<GEMINI_CLI_HOME>/.gemini/`, not directly at that root: settings, OAuth credentials, caches, temporary session/history state and account metadata. Sources: [home resolver](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/utils/paths.ts), [storage paths](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/config/storage.ts).

System/default settings may be relocated using `GEMINI_CLI_SYSTEM_SETTINGS_PATH` and `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`; workspace and administrative settings still participate. Source: [settings loader](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/settings.ts).

**Inference:** separate homes permit independently configured/logged-in processes on one machine. Actual two-account parallel operation, OAuth refresh interaction and every platform's ancillary state are **unverified**. Login must occur through Gemini itself; agent-band must not read or copy `oauth_creds.json`.

### 3. Permissions and sandbox

The baseline has `default`, `auto_edit`, `yolo` and `plan` approval modes. `--allowed-tools` is a deprecated autoapproval mechanism, not a complete exclusive allowlist. `--policy` supplies additional TOML policy files per run; `--admin-policy` supplies administrator policy. Sources: [CLI option definitions](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts), [policy engine](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/reference/policy-engine.md).

Rules can match tool names and choose `allow`, `deny` or `ask_user`; in headless mode ask-user becomes denial. Tier/priority resolution matters: inherited admin policy can override a lower-tier rule. Compile policy at an appropriate controlled tier, and use explicit fallback deny when implementing an allowlist. This is enforced tool dispatch, not a boundary around arbitrary programs run by an allowed shell.

`--sandbox`/`-s`, settings and `GEMINI_SANDBOX` choose supported sandbox backends. Default macOS `permissive-open` limits writes but permits broad reads and network; restrictive/strict and proxied variants have different behavior. Container mounts, images and network configuration need separate validation. Merely passing `-s` does not prove no-network or read-root confinement. Source: [sandbox profiles/backends](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/sandbox.md). Strict policy on every target OS/backend is **unverified**.

### 4. BeforeTool hooks and failure semantics

`BeforeTool` receives the tool name/input and can return `{"decision":"deny","reason":"..."}`. Put generated hook settings in an isolated run home or a run-specific settings source; the user profile need not be modified. Repository/extension hooks can still merge, so control the effective sources. Sources: [hook reference](https://geminicli.com/docs/hooks/reference/), [configuration](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/reference/configuration.md).

The source default is 60,000 ms. A timed-out process is terminated, but no denial output is produced. Aggregation and scheduler code continue when no blocking before-tool output exists: **fail open relative to the custom gate**. Sources: [hook runner](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/hooks/hookRunner.ts), [aggregator](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/hooks/hookAggregator.ts), [event handler](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/hooks/hookEventHandler.ts), [scheduler hook handling](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/scheduler/hook-utils.ts).

The public reference describes exit 2 as blocking and other nonzero codes as warning behavior. The pinned runner instead treats exit 1 as nonblocking and other nonzero codes as denial. This conflict is **unverified at runtime**. Use a valid successful JSON denial or documented exit 2; never rely on an arbitrary failure exit. As with the other CLIs, an API wrapper should catch failures before the CLI's own timeout.

### 5. Per-run skills and extensions

Skills come from built-in, extension, user and workspace locations, including `.gemini/skills` and `.agents/skills`. `activate_skill` has a consent step with access implications; headless use requires an appropriate policy. Native enable/disable settings work with names, not agent-band IDs/hashes. Source: [skill guide](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/skills.md).

`--extensions` selects installed extensions. Local extension installation/linking writes the chosen home; a generated temporary home avoids modifying the user's home, but installation is not a session-only arbitrary-directory flag. Sources: [extension reference](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/extensions/reference.md), [extension CLI selector](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts).

**Inference:** materialize selected skill bytes into a controlled temporary home and exclude other discovered/built-in/workspace skills. Exact exclusive loading and consent-free headless activation are **unverified** until tested. Installing extensions may also install hooks/tools, so admission filtering must inspect the full bundle.

### 6. Custom providers

The documented native API-key path uses `GEMINI_API_KEY`; Vertex routes use their own Google authentication/project/location settings. `GOOGLE_GEMINI_BASE_URL` and `GOOGLE_VERTEX_BASE_URL` override those API endpoints; HTTPS is required except permitted loopback use. Source: [configuration/environment reference](https://geminicli.com/docs/reference/configuration/).

These configure Google's native API route, not an OpenAI `chat`/`responses` wire selector. Direct support for arbitrary OpenAI-compatible endpoints is **unverified**; a protocol translator must be independently validated rather than advertised from a base-URL flag alone.

### 7. Non-interactive identity

The implementation caches an active email and previously used accounts in account metadata under the isolated home. This is non-secret metadata, but cached email is not proof of the current authenticated identity. Sources: [account metadata manager](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/utils/userAccountManager.ts), [metadata storage path](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/config/storage.ts).

A supported standalone non-interactive email/org command is **unverified**. Organization/workspace identity is also **unverified**. Do not read OAuth tokens to compensate; mark deduplication incomplete when only cached email is available.

### 8. Recent changes

The baseline deprecates `--allowed-tools` in favor of the policy engine, and supports `plan`, `--policy` and `--admin-policy`. Exact introduction/removal release boundaries are **unverified**; source-confirmed availability at 0.62.0 should not be projected onto older installations. Sources: [CLI definitions](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts), [0.62.0 release](https://github.com/google-gemini/gemini-cli/releases/tag/v0.62.0). Hook failure semantics also have the docs/source conflict described above.

## Implications for agent-band

1. Pin supported versions and OS sandbox backends; maintain sanitized event and identity fixtures. Test allow, deny, hook timeout, malformed response, service outage, uncovered tool and child-process cancellation cases.
2. Record enforcement capability per rule and tool category. Never label every tool “runtime enforced” merely because a hook exists.
3. Correct/gate the Codex chat-wire option; investigate Claude reset-window telemetry and Codex rollout snapshot completeness before exposing quota-window badges.
4. Obtain identity through supported metadata surfaces. Missing email/org stays unknown; never read provider session tokens.
5. Resolve skills discovery, inherited hooks and config precedence in an implementation ADR. A temporary bundle added to an existing discovery environment is not an exclusive skill allowlist.
6. Implement `maxRunMinutes` in the runner using a deadline and process-tree/container cancellation. A hook timeout is a different timer, and a tool-call check cannot cancel an idle or already-running process.
7. If policy requires a strict filesystem jail or guaranteed fail-closed network authorization, add a controlled executor boundary. Native defaults and prompt instructions are insufficient.

## Pre-approved tools and presets (agent-band mapping)

`presets` and `preApprovedTools` in a policy are "allowed without asking", separate from the exclusive `allowedTools` allowlist. The effective set is expand(presets) union preApprovedTools, minus rules covered by `deniedTools`, limited to `allowedTools` when it is set.

- Claude: the effective rules are added to `--allowedTools`, so headless Claude does not auto-deny them in `acceptEdits`. The PreToolUse hook also prints an explicit `permissionDecision: allow` when the policy check passes and the call matches a pre-approved rule (`Tool`, or `Bash(prefix:*)` against the command; commands with `;`, `&`, `|`, backticks, `$(`, redirects or newlines never match a scoped Bash rule). Other allowed calls print nothing. Read-only runs keep only WebSearch and WebFetch so plan mode is not bypassed.
- Codex: there are no per-tool rules. When the set contains WebSearch, WebFetch, `Bash(curl:*)` or `Bash`, `edit` mode runs with `-c sandbox_workspace_write.network_access=true`; other rules have no Codex effect.

## Policy matrix

Cells describe the strongest verified native mechanism for the stated scope, not a completed agent-band adapter. `workDirs` means checking that the task's starting directory belongs to the configured absolute roots; that is admission only. Strict confinement of all reads/writes below those roots is **unverified** across the three baselines and must not be inferred from this row. `maxMode` means selecting/capping native modes, with read-only requiring the additional controls described above. Tool rows cover named dispatch boundaries, not all side effects of an allowed shell.

“Not possible” for a duration limit means no verified native whole-run wall-clock deadline in the examined interfaces; a comprehensive absence claim is **unverified**, and the external runner can enforce it. “Enforceable via hook” requires a functioning hook and covered tool; it does not promise fail-closed infrastructure failures.

| Policy rule     | Claude Code 2.1.292        | Codex 0.160.1                   | Gemini 0.62.0              |
| --------------- | -------------------------- | ------------------------------- | -------------------------- |
| workDirs        | admission only [^c-dir]    | admission only [^o-dir]         | admission only [^g-dir]    |
| maxMode         | enforced by CLI [^c-mode]  | enforced by CLI [^o-mode]       | enforced by CLI [^g-mode]  |
| allowedTools    | enforced by CLI [^c-tools] | enforceable via hook [^o-tools] | enforced by CLI [^g-tools] |
| deniedTools     | enforced by CLI [^c-tools] | enforceable via hook [^o-tools] | enforced by CLI [^g-tools] |
| maxRunMinutes   | not possible [^c-time]     | not possible [^o-time]          | not possible [^g-time]     |
| allowedSkillIds | admission only [^c-skills] | admission only [^o-skills]      | admission only [^g-skills] |
| network         | enforced by CLI [^c-net]   | enforced by CLI [^o-net]        | enforced by CLI [^g-net]   |

[^c-dir]: [CLI working-directory/tool controls](https://code.claude.com/docs/en/cli-reference) and [sandbox read/write policy](https://code.claude.com/docs/en/sandboxing). Admission checks belong to agent-band; restricted built-in file tools and shell sandboxing have different coverage.

[^o-dir]: [Shared cwd/add-dir options](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/shared_options.rs) and [filesystem policy](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/protocol/src/permissions.rs). Write roots do not imply equivalent read roots.

[^g-dir]: [Sandbox profiles](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/sandbox.md). Default permissive-open is not a complete root jail.

[^c-mode]: [Permission modes](https://code.claude.com/docs/en/permissions). Plan/acceptEdits alone do not prove OS read-only/edit confinement; apply restricted tools and sandbox settings.

[^o-mode]: [Sandbox and approval options](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/shared_options.rs). Requires supported sandbox and no escape escalation.

[^g-mode]: [Approval modes](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts) and [policy resolution](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/reference/policy-engine.md). Explicit deny rules/sandbox supplement plan.

[^c-tools]: [Tool flags](https://code.claude.com/docs/en/cli-reference). Use `--tools` for built-ins and explicit MCP denial; `--allowedTools` alone is autoapproval, not an allowlist. EndConversation/customization exceptions remain.

[^o-tools]: [Hook coverage and configuration](https://developers.openai.com/codex/hooks) and [deny processing](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/hooks/src/events/pre_tool_use.rs). Hosted web search and write_stdin are not universally gated; errors can fail open.

[^g-tools]: [Native TOML policy engine](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/reference/policy-engine.md). Compile deny/default rules at a controlled priority; an allowed shell retains its subprocess capabilities.

[^c-time]: [CLI option reference](https://code.claude.com/docs/en/cli-reference). Turn/spend limits are not a verified elapsed-time deadline.

[^o-time]: [Exec options](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/cli.rs). Cancellation must come from the runner; hook timeouts do not bound run duration.

[^g-time]: [Headless limits](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/headless.md). Max-turn failure is not a wall-clock deadline.

[^c-skills]: [Skill discovery and permissions](https://code.claude.com/docs/en/skills), [session plugin loading](https://code.claude.com/docs/en/plugins-reference). Agent-band filters IDs/hashes before materialization; native discovery must then be constrained.

[^o-skills]: [Discovery](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/ext/skills/src/loader/discovery.rs), [enable/disable config](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/config/src/skills_config.rs). Native paths/names do not enforce library IDs or immutable hashes.

[^g-skills]: [Skill roots/activation](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/skills.md). Admission filters library IDs; exclusive effective discovery remains unverified.

[^c-net]: [Shell sandbox network controls](https://code.claude.com/docs/en/sandboxing). Only supported sandboxed subprocesses; hook/model/MCP traffic needs separate consideration.

[^o-net]: [Sandbox config](https://developers.openai.com/codex/config-advanced), [Linux backend](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/linux-sandbox/README.md). Applies to the configured executor boundary, not every model/MCP connection.

[^g-net]: [Sandbox profiles/backends](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/sandbox.md). Requires a restrictive/proxied or controlled-container network configuration; default sandboxing leaves network available.

## Native account and usage APIs

Free (no model call) ways to read identity, limits and login per provider. agent-band never reads or stores session tokens; it only spawns the official commands.

### Claude Code

- Identity: `claude auth status` prints JSON (`loggedIn`, `authMethod`, `email`, `orgId`, `orgName`, `subscriptionType`). Not logged in: `loggedIn: false`, exit code 1. With `ANTHROPIC_API_KEY` set it reports `authMethod: api_key` without validating the key, so an API key is only verified on the first run.
- Limits: `claude -p "/usage" --output-format json` answers locally (cost 0, no model). The `result` text lists "Current session", "Current week (all models)" and optional per-model weeks with a percentage and a reset time in the user's IANA zone.
- Login: `CLAUDE_CONFIG_DIR=<dir> claude auth login` (subscription), `--console` for Anthropic Console (API billing). Opens a browser and prints the URL.
- Default config dir: leave `CLAUDE_CONFIG_DIR` unset; setting it changes where the macOS Keychain entry is looked up.

### Codex CLI (0.160)

- `codex app-server` speaks JSON-RPC 2.0 over stdio, one JSON object per line (`CODEX_HOME=<dir>` for non-default accounts; the directory must exist). Handshake: `initialize`, then the `initialized` notification.
- Identity: `account/read` returns `account: { type, email, planType }` or `account: null`.
- Limits: `account/rateLimits/read` returns `rateLimits.primary` (300 min window) and `secondary` (10080 min) with `usedPercent` and `resetsAt` (unix seconds), `credits`, `planType`, `ordinaryUsageAllowed`, `rateLimitReachedType`.
- Usage history: `account/usage/read` returns `dailyUsageBuckets` (date and tokens).
- Login: `account/login/start` with `{ type: "chatgpt" }` returns `authUrl`; the `account/login/completed` notification ends the flow. Fallback: `codex login`.
- API key: `OPENAI_API_KEY` in the environment is not used for account state. Run `codex login --with-api-key` once with the key on stdin inside a private `CODEX_HOME`; the key is never passed in argv.
- Fallback for older versions: `codex login status` text and the newest `$CODEX_HOME/sessions/**/rollout-*.jsonl` token_count line.

### Gemini

To be researched.
