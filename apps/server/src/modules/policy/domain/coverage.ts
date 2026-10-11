import type { EffectivePolicyDto, EffectiveRule, PolicyRules, ProviderDto } from '@agent-band/contracts';
import type { EffectivePolicy } from './rules.ts';

export function describePolicy(
  policy: EffectivePolicy,
  provider: Pick<ProviderDto, 'harness' | 'adapterEnabled' | 'capabilities'>,
): EffectivePolicyDto {
  const rules: EffectivePolicyDto['rules'] = {};
  const values = { ...policy, workDirs: policy.workDirSets };
  const names = new Set<keyof PolicyRules>([
    'workDirs',
    'maxMode',
    'deniedTools',
    ...(Object.keys(policy.provenance ?? {}) as (keyof PolicyRules)[]),
  ]);
  for (const name of names) {
    const details: EffectiveRule['coverageDetails'] = [];
    let coverage: EffectiveRule['coverage'] = 'admission';
    if (!provider.adapterEnabled) {
      coverage = 'not-enforced';
      details.push({ mechanism: coverage, scope: 'Provider adapter is disabled.' });
    } else if (name === 'workDirs') {
      details.push({ mechanism: 'admission', scope: 'Task starting directory.' });
      if (provider.capabilities.runtimeToolEnforcement)
        details.push({
          mechanism: 'runtime-hook',
          scope:
            provider.harness === 'gemini-cli'
              ? 'Paths in Gemini read_file/write_file/replace/glob/list_directory/grep_search tool calls; read_many_files is blocked.'
              : provider.harness === 'antigravity-cli'
                ? 'Paths in agy view_file/write_to_file/replace_file_content/list_dir/find_by_name/grep_search tool calls; calls whose path cannot be read are blocked.'
                : 'Paths in Claude Read/Edit/Write/Glob/Grep tool calls.',
        });
      if (provider.harness === 'codex-cli')
        details.push({ mechanism: 'cli-sandbox', scope: 'Workspace writes in workspace-write mode.' });
      details.push({ mechanism: 'not-enforced', scope: 'Reads outside workDirs through shell commands.' });
    } else if (name === 'allowedTools' || name === 'deniedTools') {
      coverage = provider.capabilities.runtimeToolEnforcement ? 'runtime-hook' : 'not-enforced';
      details.push({
        mechanism: coverage,
        scope:
          coverage === 'runtime-hook'
            ? 'Named tool dispatch; does not confine side effects of an allowed shell. CLI hook-runner crashes remain outside our control.'
            : 'No agent-band pre-tool hook for this adapter.',
      });
    } else if (name === 'preApprovedTools' || name === 'presets') {
      coverage = provider.capabilities.runtimeToolEnforcement ? 'runtime-hook' : 'cli-sandbox';
      // The agy hook can deny but not grant, and headless agy takes no per-run allow rules.
      if (provider.harness === 'antigravity-cli') coverage = 'not-enforced';
      details.push({
        mechanism: coverage,
        scope:
          provider.harness === 'antigravity-cli'
            ? 'Not applied: headless agy auto-denies shell commands in plan and accept-edits modes and has no per-run allow rules; only full-auto runs them.'
            : coverage === 'runtime-hook'
              ? provider.harness === 'gemini-cli'
                ? 'Mapped to Gemini --allowed-tools rules (auto-approval, not an exclusive allowlist); the BeforeTool hook still denies denied tools.'
                : 'Passed to Claude as allowed tool rules and granted explicitly by the pre-tool hook; denied and disallowed tools still win.'
              : 'Web and curl rules enable network access in the Codex workspace-write sandbox; other rules are not enforced.',
      });
    } else if (name === 'maxMode') {
      coverage = 'cli-sandbox';
      details.push({
        mechanism: coverage,
        scope: 'Native CLI mode cap and sandbox controls; not a general filesystem jail.',
      });
    } else if (name === 'maxRunMinutes') {
      coverage = 'runner';
      details.push({
        mechanism: coverage,
        scope: 'The agent-band runner cancels the whole process group when the deadline passes.',
      });
    } else {
      details.push({
        mechanism: coverage,
        scope:
          name === 'allowedSkillIds'
            ? 'Library IDs filtered before materialization; native discovery is not an exclusive allowlist.'
            : 'Service admission or orchestration checks.',
      });
    }
    const provenance = policy.provenance?.[name];
    rules[name] = {
      value: values[name],
      setBy: provenance?.setBy ?? null,
      contributors: provenance?.contributors ?? [],
      coverage,
      coverageDetails: details,
    };
  }
  return { ...policy, rules };
}
