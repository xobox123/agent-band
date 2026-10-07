import { describe, expect, it } from 'vitest';
import { ago, isStale, planLabel, resetsIn, slugify, suggestedLoginCommand } from './account.ts';

const now = Date.parse('2026-10-07T08:00:00Z');

describe('account helpers', () => {
  it('names plans per provider', () => {
    expect(planLabel('claude', 'pro')).toBe('Claude Pro');
    expect(planLabel('openai', 'plus')).toBe('ChatGPT Plus');
    expect(planLabel('claude', 'API key')).toBe('API key');
    expect(planLabel('claude', null)).toBeNull();
  });
  it('formats relative times and staleness', () => {
    expect(ago('2026-10-07T07:55:00Z', now)).toBe('5 min ago');
    expect(ago(null, now)).toBe('never');
    expect(resetsIn('2026-10-07T11:01:00Z', now)).toBe('in 3h');
    expect(resetsIn('2026-10-07T08:25:00Z', now)).toBe('in 25 min');
    expect(resetsIn('2026-10-07T07:00:00Z', now)).toBe('now');
    expect(isStale('2026-10-07T07:50:00Z', now)).toBe(false);
    expect(isStale('2026-10-07T07:30:00Z', now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });
  it('suggests a login command from the account name', () => {
    expect(slugify(' Side  Gig! ')).toBe('side-gig');
    expect(suggestedLoginCommand('claude', 'Side Gig')).toBe(
      'CLAUDE_CONFIG_DIR=~/.claude-side-gig claude auth login',
    );
    expect(suggestedLoginCommand('openai', 'Work')).toBe('CODEX_HOME=~/.codex-work codex login');
  });
});
