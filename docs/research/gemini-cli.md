# Gemini CLI provider research

Research date: 2026-10-07. Baseline: **Gemini CLI 0.62.0**, pinned to [release v0.62.0](https://github.com/google-gemini/gemini-cli/releases/tag/v0.62.0). This matches [the CLI capability matrix](./cli-capability-matrix.md). Availability at this tag does not establish introduction versions or compatibility with older installations. Record `gemini --version` at admission.

Evidence below comes from official documentation and inspection of tagged source, not a real-account smoke test. No CLI login, model request, paid API or credential inspection was performed. Recommendations are explicitly proposals. Live documentation can differ from the pinned implementation.

## 1. Non-interactive execution and output

```sh
GEMINI_CLI_HOME=/accounts/example gemini \
  --prompt 'TASK' --output-format stream-json --approval-mode default
```

Use a spawned process with an explicit `cwd`, argument array and controlled environment. `-p`/`--prompt` selects headless execution even with a TTY; non-TTY execution also selects headless mode. Output formats are `text`, `json` and `stream-json`. Documented exit codes are 0 (success), 1 (general/API failure), 42 (input error) and 53 (turn limit). A turn limit is not a wall-clock deadline. Sources: [headless reference](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/headless.md), [CLI arguments](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts).

Single JSON output has optional `session_id`, `response`, `stats`, `error` and `warnings`. The error shape is `{ type, message, code? }`. Streaming output is one JSON object per stdout line, with `type` and `timestamp`:

| Event         | Fields beyond type/timestamp                        | Adapter use                      |
| ------------- | --------------------------------------------------- | -------------------------------- |
| `init`        | `session_id`, `model`                               | Session ID and requested model   |
| `message`     | `role`, `content`, optional `delta`                 | Assistant text; ignore user echo |
| `tool_use`    | `tool_name`, `tool_id`, `parameters`                | Tool request, not approval proof |
| `tool_result` | `tool_id`, `status`, optional `output`, `error`     | Correlate completion             |
| `error`       | `severity: warning\|error`, `message`               | Preserve severity internally     |
| `result`      | `status: success\|error`, optional `error`, `stats` | Final status and usage           |

Sources: [output types](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/output/types.ts), [JSON formatter](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/output/json-formatter.ts), [headless emitter](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/nonInteractiveCli.ts). Treat stderr separately. Parse across arbitrary byte/chunk boundaries, bound line sizes and retain unknown event types for diagnostics. An interrupted process may lack a final result; neither an earlier warning nor exit 0 alone should replace result validation.

## 2. Usage, tokens and quota

Streaming `result.stats` contains `total_tokens`, `input_tokens`, `output_tokens`, `cached`, `input`, `duration_ms`, `tool_calls` and `models`. Each model has the same token fields. The formatter maps prompt tokens to `input_tokens`, candidate tokens to `output_tokens`, and preserves cached and uncached input separately. Aggregate totals are sums across models, so do not add the per-model breakdown to those totals again. Source: [stream formatter](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/output/stream-json-formatter.ts).

Single JSON exposes richer `stats.models[model].tokens`: `input`, `prompt`, `candidates`, `total`, `cached`, `thoughts` and `tool`, plus request/error/latency metrics and role breakdowns. Stream output omits separate thoughts/tool-token counts. Do not infer reasoning usage from `total_tokens - input_tokens - output_tokens`, or claim an exact cost from these counters. There is no billed USD or quota-window field in the examined output types. Sources: [telemetry schema](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/telemetry/uiTelemetry.ts), [output schema](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/output/types.ts).

Quota is authentication dependent: Google-account Code Assist subscription/request limits, Gemini API pricing-tier limits, or Vertex AI dynamic shared quota/provisioned throughput. Model calls, agent turns and user tasks are different units. Static advertised plan allowances do not report an account's remaining quota. Sources: [quota/pricing reference](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/resources/quota-and-pricing.md), [Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas), [Vertex dynamic shared quota](https://cloud.google.com/vertex-ai/generative-ai/docs/resources/dynamic-shared-quota).

### Is there a free remaining-quota command?

**Interactive `/stats` (alias `/usage`) is a metadata operation, not a model-generation request.** Its action refreshes quota and available credits, reads email/auth type/tier, and builds a display with quota buckets, pooled remaining/limit/reset and credit balance when available. It still contacts account services; not every authentication path supplies these values. Source: [stats command](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/ui/commands/statsCommand.ts).

**Do not advertise `gemini -p '/stats' --output-format json` as a free headless quota probe.** The pinned built-in loader includes `/stats`, but its action returns no prompt result. The non-interactive UI ignores the structured stats item, and the headless runner falls back to normal prompt handling when command handling returns undefined. Source inspection therefore indicates a possible model request with the literal slash-command input, rather than machine-readable quota output. Runtime behavior is untested. Sources: [built-in loader](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/services/BuiltinCommandLoader.ts), [command handler](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/nonInteractiveCliCommands.ts), [non-interactive UI](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/ui/noninteractive/nonInteractiveUi.ts), [fallback path](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/nonInteractiveCli.ts).

No supported standalone headless identity/plan/remaining-quota JSON command was verified at this baseline. A future official metadata interface is preferable to importing internal account-service code or scraping a terminal UI.

## 3. Account home, login and identity

`GEMINI_CLI_HOME` replaces the home root, not the `.gemini` directory itself. Normal settings and OAuth storage live under `<root>/.gemini/`; user skills also include `<root>/.agents/skills`. Under `SANDBOX=sandbox-exec`, runtime state moves to `<root>/.cache/.gemini/`, while global settings and OAuth credential paths remain in `.gemini`. This qualifies the matrix's simplified storage description. Sources: [home resolver](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/utils/paths.ts), [storage paths](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/config/storage.ts).

Separate account homes are the proposed isolation mechanism. They do not isolate all system/workspace configuration or external Google ADC state. `GEMINI_CLI_SYSTEM_SETTINGS_PATH` and `GEMINI_CLI_SYSTEM_DEFAULTS_PATH` relocate system settings sources; workspace settings, environment files, extensions and administrator policy still need review. Source: [settings loader](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/settings.ts).

| Login method         | Setup and headless reuse                                                                                                                                                                                                                                   | Identity/plan limitations                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Google account OAuth | Run interactive `gemini` in the chosen account home and select Sign in with Google. Reuse that home after login. `NO_BROWSER` controls browser opening for environments needing a manual flow.                                                             | Cached Google email exists; live tier/credits are shown by `/stats`. Neither is a verified standalone headless account API. |
| Gemini API key       | Supply `GEMINI_API_KEY` privately through the process environment and select the corresponding auth method.                                                                                                                                                | Key possession/configuration is not verified identity or a subscription plan. No Google-account email should be inferred.   |
| Vertex AI            | Select Vertex authentication; configure `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. Supported credentials include ADC (`gcloud auth application-default login`), a service-account file via `GOOGLE_APPLICATION_CREDENTIALS`, or `GOOGLE_API_KEY`. | Project/location are configuration, not proof of a user or organization. ADC can live outside the Gemini home.              |

Sources: [tagged authentication guide](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/get-started/authentication.mdx), [no-browser configuration](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts). Clear unrelated inherited key/auth variables when choosing a route. Interactive onboarding may require a Cloud project for organizational accounts; do not assume all Google logins have the individual free tier.

`UserAccountManager` stores non-secret account metadata `{ active: string|null, old: string[] }` at `Storage.getGoogleAccountsPath()`. Reading `active` would provide a cached email non-interactively, but this is an internal file contract and can be stale after auth-route changes. Agent-band's matrix requires official commands for identity, so this should remain a separately reviewed fallback, not silently become authoritative account deduplication. Do not read or decode `oauth_creds.json`, ADC credentials or MCP token files. Sources: [account manager](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/utils/userAccountManager.ts), [storage](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/config/storage.ts).

## 4. Tool permission controls and sandbox

Native approval modes are `default`, `auto_edit`, `yolo` and `plan`. In headless policy evaluation, `ask_user` becomes denial. `--allowed-tools` is deprecated and autoapproves matching tools; it is not an exclusive allowlist. Use generated TOML through `--policy` or `--admin-policy`, with `toolName`, optional `mcpName`/argument conditions, `decision` (`allow`, `deny`, `ask_user`) and `priority`. Compile an explicit fallback deny for an exclusive allowlist. Sources: [CLI flags](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts), [policy engine](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/reference/policy-engine.md).

Higher-tier policy beats lower-tier numeric priorities. The pinned policy guide warns that workspace-tier policy discovery is non-functional; use explicit CLI policy paths rather than assuming `.gemini/policies` in the repository is enforced. Mode rules, inherited administrator rules and subagent-specific dispatch must be included in effective-policy verification. Allowing `run_shell_command` permits its subprocess effects; syntactic command-prefix rules do not establish shell confinement. Source: [policy tiers and matching](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/reference/policy-engine.md).

`--sandbox`/`-s` and `GEMINI_SANDBOX` select native sandbox backends. Default macOS `permissive-open` permits broad reads and network while restricting writes. Restrictive/strict/proxied profiles and container configuration have different boundaries. Validate OS/backend, mounts and network policy before asserting confinement. Hooks, model traffic and external MCP servers require separate consideration. Source: [sandbox guide](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/sandbox.md).

## 5. BeforeTool hooks

Command hooks receive JSON on stdin, including common session/event/cwd fields and `tool_name`, `tool_input`, optional `mcp_context` and `original_request_name`. Stdout is the hook response, not log output. Tool matchers are regular expressions; `*` matches all. Example generated settings:

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "agent-band-policy",
            "type": "command",
            "command": "/runner/bin/gemini-policy-hook",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

A successful response denying one call:

```json
{ "decision": "deny", "reason": "Tool is outside the effective policy" }
```

`decision: "allow"` permits continuation of hook processing; it should not be interpreted as bypassing native policy. `hookSpecificOutput.tool_input` merges argument overrides. `continue: false` with `stopReason` stops the agent loop. Denial feedback reaches the model, so reasons must contain no secrets. Exit 2 blocks the tool with stderr as the reason while allowing the turn to continue. Sources: [hook setup](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/hooks/index.md), [protocol](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/hooks/reference.md).

Default timeout is 60,000 ms. Timeout/launch failures produce no valid custom denial, and the scheduler can continue normal execution: hooks are not a guaranteed fail-closed authorization boundary. The runner's plain-text conversion treats exit 1 as a warning and other nonzero codes as denial, whereas the reference documents other non-2 failures as warnings. Prefer exit 0 with valid JSON denial or documented exit 2; test the discrepancy. Sources: [hook runner](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/hooks/hookRunner.ts), [aggregator](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/hooks/hookAggregator.ts), [scheduler](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/core/src/scheduler/hook-utils.ts).

## 6. MCP configuration per run

MCP definitions belong in `settings.json` under `mcpServers`, with stdio `command`/`args`/`env`/`cwd`, SSE `url`, or Streamable HTTP `httpUrl`; optional controls include `timeout`, `trust`, `includeTools` and `excludeTools`. `--allowed-mcp-server-names` filters configured server names, but does not itself define a server. A per-run settings overlay in controlled settings sources can supply the definition without modifying repository files. No equivalent arbitrary `--mcp-config FILE` flag was verified. Sources: [MCP reference](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/tools/mcp-server.md), [configuration loader](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts).

```json
{
  "mcpServers": {
    "agent-band": {
      "httpUrl": "http://127.0.0.1:PORT/mcp",
      "headers": { "Authorization": "Bearer $AGENT_BAND_RUN_TOKEN" },
      "trust": false
    }
  }
}
```

This is a proposed template, with an actual port supplied by the runner. Resolve secrets through supported environment substitution, never literal secret argv or logs. Admit only approved servers/tools and apply native policy; `trust: true` would bypass confirmations for that server. Account-home mutations need serialization or a validated per-run overlay because concurrent runs must not overwrite one shared settings file. Administrator-required and extension servers can affect the effective set. Source: [MCP transports, substitutions and filtering](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/tools/mcp-server.md).

## 7. Models, extensions and skills

`--model` selects a model; interactive `/model` opens a selector with Auto/Manual choices. It does not override subagent models, so retain actual per-model usage. No standalone `gemini models list --json` command was found in the pinned CLI definitions. A versioned suggested catalog is not account entitlement discovery; the Gemini API's separate Models API also does not establish OAuth Code Assist availability. Sources: [model selection](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/model.md), [CLI definitions](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts), [Gemini API models endpoint](https://ai.google.dev/api/models).

`--list-extensions` lists installed extensions and exits; `--extensions` selects installed extensions, with all used by default. Extensions can contribute context, MCP servers, commands, hooks and skills. Installation/linking persists in the selected home, rather than providing a verified session-only arbitrary-directory bundle flag. Sources: [extension reference](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/extensions/reference.md), [extension selection flags](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/packages/cli/src/config/config.ts).

Skills use `SKILL.md` and supporting resources, discovered from built-in, extension, user and workspace roots, including `.gemini/skills` and `.agents/skills`. Activation through `activate_skill` has consent/access implications. Native names and enable/disable state do not enforce agent-band immutable IDs or content hashes. Filter and hash selected bundles before launch, then verify exclusive discovery and headless activation. Source: [skills guide](https://github.com/google-gemini/gemini-cli/blob/v0.62.0/docs/cli/skills.md).

## 8. Proposed agent-band adapter

Keep the descriptor disabled until implementation verification, as required by [the design](../superpowers/specs/2026-10-06-agent-band-design.md). Follow the existing [capability matrix](./cli-capability-matrix.md) and [runner contract](../../packages/contracts/src/runner.ts):

1. Register provider `gemini`, harness `gemini-cli`, with version/OS admission. The current adapter provider union excludes Gemini, so a future implementation must extend it explicitly. Distinguish OAuth, API-key and Vertex authentication even when all execution uses this CLI.
2. Launch `gemini -p <prompt> --output-format stream-json` in the admitted work directory with per-account `GEMINI_CLI_HOME`, explicit model/mode/policy, controlled configuration and existing agent/git attribution variables. Keep credentials owned by the CLI. Do not copy an authenticated account home to create each run.
3. Normalize `init` to `session`, assistant messages to `text`, `tool_use` to `tool`, and final token totals once to `usage`. Map `input_tokens` to `inputTokens`, `output_tokens` to `outputTokens`, `cached` to `cachedTokens`; retain raw per-model accounting privately. Emit `tool_decision` from the agent-band authorization wrapper, not from a tool request or successful result. Preserve stderr and distinguish warnings from fatal errors. Reconcile process exit and terminal result, and implement `cancel()` plus runner-owned wall-clock/process-tree cancellation.
4. Compile denied tools at higher priority than approved tools and an exclusive allowlist fallback. Expand presets plus `preApprovedTools`, subtract denies and intersect with `allowedTools` when present, as in the matrix. Map read-only to plan plus explicit write/shell restrictions and verified sandbox; edit to auto_edit plus policy; full-auto to a controlled automatic policy. Do not let yolo override admission requirements. Dynamic hook checks supplement native deny policy.
5. Configure approved per-run MCP servers and hashed skill bundles through isolated controlled settings sources, without shared-account settings races. Disable or reject unapproved inherited extensions/hooks/skills. OS sandboxing and MCP service authorization remain separate boundaries.
6. Advertise token usage, conditional native runtime tool enforcement and provisional skills support. Leave `costReporting` false and `limitWindows` empty. Google daily/model quotas must not be relabeled as the contract's `5h`/`weekly` windows. Identity/plan/remaining quota stay unknown unless an approved metadata mechanism is added. Do not run a model prompt to discover them.

| Policy rule                   | Proposed enforcement, matching the matrix                               |
| ----------------------------- | ----------------------------------------------------------------------- |
| `workDirs`                    | Admission check only; cwd is not a jail                                 |
| `maxMode`                     | Native mode plus policy/sandbox verification                            |
| `allowedTools`, `deniedTools` | Native controlled-tier TOML rules; hooks for dynamic checks             |
| `maxRunMinutes`               | External runner deadline and process-tree cancellation                  |
| `allowedSkillIds`             | Admission IDs/hashes; effective discovery still needs validation        |
| `network`                     | Verified restrictive/proxied/container boundary, scoped to its coverage |

## 9. Unknowns and implementation gates

- Two isolated OAuth accounts running simultaneously on each supported OS, including refresh behavior, sandbox runtime paths and external ADC isolation.
- A supported free headless identity/plan/quota metadata API; safe handling of stale cached email and subscription changes. No authoritative organization identity was verified.
- Runtime confirmation of `/stats` headless fallthrough, without permitting any real model request in automated tests.
- Hook timeout, crash, malformed-output and nonzero-exit behavior; complete coverage of MCP, subagents and tail calls; inherited-hook argument rewriting after authorization.
- Effective policy precedence, yolo overrides, administrator-required MCP servers, extension discovery and exact exclusive skill loading/activation in headless mode.
- A concurrent-run settings overlay that retains CLI-owned authentication without credential copying or shared settings races.
- Model entitlement discovery across OAuth/API/Vertex, auto routing/fallback behavior and resumed-session/subagent accounting completeness.
- Sanitized event fixtures for errors, truncation, cancellation and quota exhaustion; supported sandbox/backend containment and reliable child-process shutdown.

Resolve these with controlled local/fake-response tests and separately authorized account smoke tests before enabling the adapter. This document proposes no implementation or contract changes.
