import { describe, expect, it } from 'vitest';
import { type RunStartRequest, evaluateRunStart } from './evaluate.ts';
import { type PolicyRules, mergePolicies } from './rules.ts';

type Level = 'org' | 'group' | 'agent';
type Lvl = { level: Level; rules: PolicyRules };

function merged(levels: Lvl[]) {
  return mergePolicies(levels.map((l, i) => ({ ...l, policyId: `p${i}`, version: 1 })));
}

const req: RunStartRequest = {
  agentEnabled: true,
  workDir: '/work/repo',
  accountId: 'acc',
  skillIds: [],
  agentTokensToday: 0,
};

describe('evaluateRunStart', () => {
  it('allows under an empty policy and uses full-auto by default', () => {
    expect(evaluateRunStart(merged([]), req)).toEqual({
      allow: true,
      reasons: [],
      mode: 'full-auto',
    });
  });

  it('collects all failing reasons together', () => {
    const p = merged([{ level: 'org', rules: { workDirs: ['/work'], dailyTokenBudget: 100 } }]);
    const d = evaluateRunStart(p, {
      ...req,
      agentEnabled: false,
      workDir: '/etc',
      agentTokensToday: 100,
    });
    expect(d.allow).toBe(false);
    expect(d.reasons).toHaveLength(3);
    expect(d.reasons.join(' ')).toMatch(/disabled/);
    expect(d.reasons.join(' ')).toMatch(/workDir/);
    expect(d.reasons.join(' ')).toMatch(/budget/);
  });

  it('allows workDir only inside every level that sets workDirs', () => {
    const p = merged([
      { level: 'org', rules: { workDirs: ['/work'] } },
      { level: 'agent', rules: { workDirs: ['/work/repo'] } },
    ]);
    expect(evaluateRunStart(p, { ...req, workDir: '/work/repo/sub' }).allow).toBe(true);
    expect(evaluateRunStart(p, { ...req, workDir: '/work/other' }).allow).toBe(false);
    expect(evaluateRunStart(p, { ...req, workDir: '/work2/repo' }).allow).toBe(false);
  });

  it('denies skills outside allowedSkillIds, one reason per skill', () => {
    const p = merged([{ level: 'org', rules: { allowedSkillIds: ['s1'] } }]);
    expect(evaluateRunStart(p, { ...req, skillIds: ['s1'] }).allow).toBe(true);
    const d = evaluateRunStart(p, { ...req, skillIds: ['s1', 's2', 's3'] });
    expect(d.allow).toBe(false);
    expect(d.reasons).toHaveLength(2);
  });

  it('denies accounts outside allowedAccountIds', () => {
    const p = merged([{ level: 'group', rules: { allowedAccountIds: ['other'] } }]);
    expect(evaluateRunStart(p, req).allow).toBe(false);
  });

  it('enforces the daily token budget at the boundary', () => {
    const p = merged([{ level: 'org', rules: { dailyTokenBudget: 100 } }]);
    expect(evaluateRunStart(p, { ...req, agentTokensToday: 99 }).allow).toBe(true);
    expect(evaluateRunStart(p, { ...req, agentTokensToday: 100 }).allow).toBe(false);
  });

  it('caps the mode instead of denying', () => {
    const p = merged([{ level: 'org', rules: { maxMode: 'edit' } }]);
    expect(evaluateRunStart(p, { ...req, requestedMode: 'full-auto' })).toMatchObject({
      allow: true,
      mode: 'edit',
    });
    expect(evaluateRunStart(p, { ...req, requestedMode: 'read-only' }).mode).toBe('read-only');
    expect(evaluateRunStart(p, req).mode).toBe('edit');
  });
});

function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element at ${i}`);
  return x;
}

// Deterministic generator so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('mergePolicies is most-restrictive (property)', () => {
  const tools = ['t1', 't2', 't3', 't4'];
  const ids = ['i1', 'i2', 'i3'];
  const dirs = ['/work', '/work/repo', '/work/repo/sub', '/other', '/work2'];
  const modes = ['read-only', 'edit', 'full-auto'] as const;

  function genRules(r: () => number): PolicyRules {
    const pick = <T>(xs: readonly T[]): T => at(xs, Math.floor(r() * xs.length));
    const subset = <T>(xs: readonly T[]) => xs.filter(() => r() < 0.6);
    const rules: PolicyRules = {};
    if (r() < 0.5) rules.workDirs = subset(dirs);
    if (r() < 0.5) rules.maxMode = pick(modes);
    if (r() < 0.5) rules.allowedSkillIds = subset(ids);
    if (r() < 0.5) rules.allowedAccountIds = subset(ids);
    if (r() < 0.5) rules.allowedTools = subset(tools);
    if (r() < 0.5) rules.deniedTools = subset(tools);
    if (r() < 0.5) rules.dailyTokenBudget = Math.floor(r() * 100);
    if (r() < 0.5) rules.maxRunMinutes = 1 + Math.floor(r() * 60);
    return rules;
  }

  it('adding a level never widens what is allowed', () => {
    const r = rng(42);
    const rank = { 'read-only': 0, edit: 1, 'full-auto': 2 } as const;
    for (let i = 0; i < 400; i++) {
      const base = Array.from({ length: Math.floor(r() * 3) }, (_, j) => ({
        level: at(['org', 'group', 'agent'] as const, j),
        policyId: `p${j}`,
        version: 1,
        rules: genRules(r),
      }));
      const extra = { level: 'agent' as const, policyId: 'x', version: 1, rules: genRules(r) };
      const before = mergePolicies(base);
      const after = mergePolicies([...base, extra]);

      for (let k = 0; k < 20; k++) {
        const request: RunStartRequest = {
          agentEnabled: true,
          workDir: at(dirs, Math.floor(r() * dirs.length)) + (r() < 0.5 ? '' : '/x'),
          accountId: at(ids, Math.floor(r() * ids.length)),
          skillIds: ids.filter(() => r() < 0.4),
          agentTokensToday: Math.floor(r() * 100),
          requestedMode: at(modes, Math.floor(r() * 3)),
        };
        const b = evaluateRunStart(before, request);
        const a = evaluateRunStart(after, request);
        if (a.allow) expect(b.allow).toBe(true);
        expect(rank[a.mode]).toBeLessThanOrEqual(rank[b.mode]);
        expect(a.reasons.length).toBeGreaterThanOrEqual(b.reasons.length);
      }

      expect(rank[after.maxMode]).toBeLessThanOrEqual(rank[before.maxMode]);
      for (const t of before.deniedTools) expect(after.deniedTools).toContain(t);
      if (before.allowedTools) {
        expect(after.allowedTools).toBeDefined();
        for (const t of after.allowedTools ?? []) expect(before.allowedTools).toContain(t);
      }
      for (const k of ['dailyTokenBudget', 'maxRunMinutes'] as const) {
        if (before[k] !== undefined) expect(after[k]).toBeLessThanOrEqual(before[k] ?? Infinity);
      }
    }
  });

  it('is order independent for restrictions', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const ls = [0, 1, 2].map((j) => ({
        level: at(['org', 'group', 'agent'] as const, j),
        policyId: `p${j}`,
        version: 1,
        rules: genRules(r),
      }));
      const a = mergePolicies(ls);
      const b = mergePolicies([...ls].reverse());
      expect(b.maxMode).toBe(a.maxMode);
      expect(b.dailyTokenBudget).toBe(a.dailyTokenBudget);
      expect([...(b.allowedTools ?? [])].sort()).toEqual([...(a.allowedTools ?? [])].sort());
      expect([...b.deniedTools].sort()).toEqual([...a.deniedTools].sort());
    }
  });
});
