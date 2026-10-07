import { describe, expect, it } from 'vitest';
import { USAGE_TEXT } from './fake-cli.testkit.ts';
import { parseClaudeUsageText, parseResetTime } from './claude-usage.ts';

const now = new Date('2026-10-07T08:00:00Z');

describe('parseClaudeUsageText', () => {
  it('reads the session, the all-models week and per-model weeks', () => {
    const usage = parseClaudeUsageText(USAGE_TEXT, now);
    expect(usage.windows).toEqual([
      { window: '5h', usedPercent: 32, resetsAt: '2026-10-07T10:20:00.000Z' },
      { window: 'weekly', usedPercent: 30, resetsAt: '2026-10-10T00:00:00.000Z' },
    ]);
    expect(usage.perModel).toEqual([
      { label: 'Sonnet', usedPercent: 12, resetsAt: '2026-10-10T00:00:00.000Z' },
    ]);
  });

  it('ignores the contributors section and unknown text', () => {
    expect(parseClaudeUsageText('Last 24h · 1788 requests\n  98% of your usage', now).windows).toEqual([]);
  });

  it('parses the exact text from the CLI', () => {
    const text =
      'Current session: 36% used · resets Oct 7 at 12:20pm (Europe/Warsaw)\nCurrent week (all models): 31% used · resets Oct 10 at 2am (Europe/Warsaw)';
    expect(parseClaudeUsageText(text, now).windows.map((w) => w.usedPercent)).toEqual([36, 31]);
  });
});

describe('parseResetTime', () => {
  it('handles relative times, today/tomorrow clocks and winter time', () => {
    expect(parseResetTime('in 3h 5m', 'UTC', now)).toBe('2026-10-07T11:05:00.000Z');
    expect(parseResetTime('12:20pm', 'Europe/Warsaw', now)).toBe('2026-10-07T10:20:00.000Z');
    expect(parseResetTime('9am', 'UTC', now)).toBe('2026-10-07T09:00:00.000Z');
    expect(parseResetTime('7am', 'UTC', now)).toBe('2026-10-08T07:00:00.000Z');
    expect(parseResetTime('Nov 2 at 2am', 'Europe/Warsaw', now)).toBe('2026-11-02T01:00:00.000Z');
  });
  it('returns null for text it cannot read', () => {
    expect(parseResetTime('soon', 'UTC', now)).toBeNull();
  });
});
