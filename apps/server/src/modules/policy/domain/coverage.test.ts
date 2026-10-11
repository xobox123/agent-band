import { describe, expect, it } from 'vitest';
import { describePolicy } from './coverage.ts';
import { mergePolicies } from './rules.ts';

const provider = (harness: 'claude-cli' | 'codex-cli' | 'gemini-cli', adapterEnabled = true) => ({
  harness,
  adapterEnabled,
  capabilities: {
    runtimeToolEnforcement: harness === 'claude-cli',
    limitWindows: [],
    costReporting: false,
    skills: true,
    systemPrompt: true,
  },
});
const org = { level: 'org' as const, policyId: 'org', version: 2 };
const agent = { level: 'agent' as const, policyId: 'agent', version: 3 };

describe('effective policy provenance and coverage', () => {
  it('keeps restrictive scalar origins and records combined list contributors', () => {
    const result = describePolicy(
      mergePolicies([
        {
          ...org,
          rules: {
            maxMode: 'read-only',
            dailyTokenBudget: 20,
            allowedTools: ['Read', 'Write'],
            canDelegate: false,
          },
        },
        {
          ...agent,
          rules: { maxMode: 'edit', dailyTokenBudget: 30, allowedTools: ['Read'], canDelegate: true },
        },
      ]),
      provider('claude-cli'),
    );
    expect(result.rules.maxMode?.setBy).toEqual(org);
    expect(result.rules.dailyTokenBudget?.setBy).toEqual(org);
    expect(result.rules.canDelegate?.setBy).toEqual(org);
    expect(result.rules.allowedTools).toMatchObject({
      value: ['Read'],
      setBy: agent,
      contributors: [org, agent],
      coverage: 'runtime-hook',
    });
  });
  it.each(['claude-cli', 'codex-cli'] as const)('reports scoped workDir enforcement for %s', (harness) => {
    const result = describePolicy(
      mergePolicies([
        {
          ...org,
          rules: { workDirs: ['/work'], allowedTools: ['Read'], maxRunMinutes: 3, allowedSkillIds: [] },
        },
      ]),
      provider(harness),
    );
    expect(result.rules.workDirs?.coverage).toBe('admission');
    expect(result.rules.workDirs?.coverageDetails.map((d) => d.mechanism)).toEqual([
      'admission',
      harness === 'claude-cli' ? 'runtime-hook' : 'cli-sandbox',
      'not-enforced',
    ]);
    expect(result.rules.allowedTools?.coverage).toBe(
      harness === 'claude-cli' ? 'runtime-hook' : 'not-enforced',
    );
    expect(result.rules.allowedSkillIds?.coverage).toBe('admission');
    expect(result.rules.maxRunMinutes?.coverage).toBe('runner');
    expect(result.rules.maxRunMinutes?.coverageDetails[0]?.scope).toContain('process group');
  });
  it('describes Gemini hook enforcement with its own tool names and no sandbox claim', () => {
    const result = describePolicy(
      mergePolicies([
        { ...org, rules: { workDirs: ['/work'], allowedTools: ['Read'], preApprovedTools: ['Read'] } },
      ]),
      {
        ...provider('gemini-cli'),
        capabilities: { ...provider('gemini-cli').capabilities, runtimeToolEnforcement: true },
      },
    );
    expect(result.rules.workDirs?.coverageDetails.map((d) => d.mechanism)).toEqual([
      'admission',
      'runtime-hook',
      'not-enforced',
    ]);
    expect(result.rules.workDirs?.coverageDetails[1]?.scope).toContain('read_file');
    expect(result.rules.allowedTools?.coverage).toBe('runtime-hook');
    expect(result.rules.preApprovedTools?.coverageDetails[0]?.scope).toContain('--allowed-tools');
  });
  it('marks disabled providers unenforced and identifies implicit defaults', () => {
    const result = describePolicy(mergePolicies([]), provider('gemini-cli', false));
    expect(result.rules.maxMode).toMatchObject({
      value: 'full-auto',
      setBy: null,
      contributors: [],
      coverage: 'not-enforced',
    });
  });
});
