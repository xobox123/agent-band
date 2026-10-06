import { describe, expect, it } from 'vitest';
import { type PolicyRules, PolicyRules as PolicyRulesSchema, mergePolicies, minMode } from './rules.ts';

type Lvl = Parameters<typeof mergePolicies>[0][number];
const lvl = (level: Lvl['level'], rules: PolicyRules, n = 1): Lvl => ({
  level,
  policyId: `${level}-${n}`,
  version: n,
  rules,
});

describe('minMode', () => {
  it('orders read-only < edit < full-auto', () => {
    expect(minMode('full-auto', 'edit')).toBe('edit');
    expect(minMode('edit', 'full-auto')).toBe('edit');
    expect(minMode('read-only', 'full-auto')).toBe('read-only');
    expect(minMode('edit', 'edit')).toBe('edit');
  });
});

describe('PolicyRules schema', () => {
  it('accepts an empty object and a full one', () => {
    expect(PolicyRulesSchema.safeParse({}).success).toBe(true);
    expect(
      PolicyRulesSchema.safeParse({
        workDirs: ['/work'],
        maxMode: 'edit',
        allowedTools: ['Read'],
        deniedTools: ['Bash'],
        dailyTokenBudget: 1000,
        maxRunMinutes: 30,
        allowedAccountIds: ['a'],
        allowedSkillIds: ['s'],
        allowAccountFailover: true,
      }).success,
    ).toBe(true);
  });

  it.each([
    { workDirs: ['relative'] },
    { maxMode: 'root' },
    { dailyTokenBudget: -1 },
    { maxRunMinutes: 0 },
    { unknown: 1 },
  ])('rejects %j', (bad) => {
    expect(PolicyRulesSchema.safeParse(bad).success).toBe(false);
  });
});

describe('mergePolicies', () => {
  it('has permissive defaults for no levels', () => {
    expect(mergePolicies([])).toEqual({
      workDirSets: [],
      maxMode: 'full-auto',
      deniedTools: [],
      sources: [],
    });
  });

  it('takes the minimum maxMode', () => {
    const e = mergePolicies([lvl('org', { maxMode: 'edit' }), lvl('agent', { maxMode: 'full-auto' })]);
    expect(e.maxMode).toBe('edit');
  });

  it('intersects allow-lists', () => {
    const e = mergePolicies([
      lvl('org', { allowedTools: ['a', 'b'], allowedSkillIds: ['s1'] }),
      lvl('agent', { allowedTools: ['b', 'c'], allowedAccountIds: ['x'] }),
    ]);
    expect(e.allowedTools).toEqual(['b']);
    expect(e.allowedSkillIds).toEqual(['s1']);
    expect(e.allowedAccountIds).toEqual(['x']);
  });

  it('keeps allow-lists unrestricted when nobody sets them, and empty when disjoint', () => {
    expect(mergePolicies([lvl('org', {})]).allowedTools).toBeUndefined();
    expect(
      mergePolicies([lvl('org', { allowedTools: ['a'] }), lvl('agent', { allowedTools: ['b'] })])
        .allowedTools,
    ).toEqual([]);
  });

  it('unions denied tools', () => {
    const e = mergePolicies([
      lvl('org', { deniedTools: ['x', 'y'] }),
      lvl('group', { deniedTools: ['y', 'z'] }),
    ]);
    expect([...e.deniedTools].sort()).toEqual(['x', 'y', 'z']);
  });

  it('takes the minimum of numeric limits', () => {
    const e = mergePolicies([
      lvl('org', { dailyTokenBudget: 1000, maxRunMinutes: 60 }),
      lvl('group', { dailyTokenBudget: 500 }),
      lvl('agent', { maxRunMinutes: 10 }),
    ]);
    expect(e.dailyTokenBudget).toBe(500);
    expect(e.maxRunMinutes).toBe(10);
  });

  it('collects one workDir set per level that sets workDirs and records sources', () => {
    const e = mergePolicies([
      lvl('org', { workDirs: ['/work'] }, 1),
      lvl('group', {}, 2),
      lvl('agent', { workDirs: ['/work/repo'] }, 3),
    ]);
    expect(e.workDirSets).toEqual([['/work'], ['/work/repo']]);
    expect(e.sources).toEqual([
      { level: 'org', policyId: 'org-1', version: 1 },
      { level: 'group', policyId: 'group-2', version: 2 },
      { level: 'agent', policyId: 'agent-3', version: 3 },
    ]);
  });

  it('leaves failover unset by default and lets any false win', () => {
    expect(mergePolicies([lvl('org', {})]).allowAccountFailover).toBeUndefined();
    expect(mergePolicies([lvl('org', {}), lvl('agent', { allowAccountFailover: true })])).toMatchObject({
      allowAccountFailover: true,
    });
    expect(
      mergePolicies([
        lvl('org', { allowAccountFailover: false }),
        lvl('agent', { allowAccountFailover: true }),
      ]).allowAccountFailover,
    ).toBe(false);
    expect(
      mergePolicies([
        lvl('org', { allowAccountFailover: true }),
        lvl('group', { allowAccountFailover: false }),
        lvl('agent', { allowAccountFailover: true }),
      ]).allowAccountFailover,
    ).toBe(false);
  });

  it('does not mutate its input', () => {
    const rules: PolicyRules = { allowedTools: ['a'], workDirs: ['/w'] };
    const copy = structuredClone(rules);
    mergePolicies([lvl('org', rules), lvl('agent', { allowedTools: ['a', 'b'] })]);
    expect(rules).toEqual(copy);
  });
});
