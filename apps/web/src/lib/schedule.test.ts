import { describe, expect, it } from 'vitest';
import { describeCron, formatRelative, localToIso } from './schedule.ts';

describe('describeCron', () => {
  it.each([
    ['* * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['30 * * * *', 'Every hour at :30'],
    ['0 */6 * * *', 'Every 6 hours'],
    ['0 9 * * *', 'Every day at 09:00'],
    ['5 18 * * 1-5', 'Every weekday at 18:05'],
    ['0 9 * * 1', 'Every Monday at 09:00'],
    ['0 9 * * 1,3', 'Mon, Wed at 09:00'],
    ['0 10 * * 0,6', 'Every weekend at 10:00'],
    ['0 8 1 * *', 'Monthly on day 1 at 08:00'],
  ])('describes %s', (cron, words) => {
    expect(describeCron(cron)).toBe(words);
  });

  it.each(['0 9 * 1 *', '0 9 1-5 * 1', '0 0 9 * * *', 'every day', '61 9 * * *', '0 25 * * *'])(
    'falls back to the raw expression for %s',
    (cron) => {
      expect(describeCron(cron)).toBe(cron);
    },
  );
});

describe('time helpers', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-10-06T10:00:00Z');
    expect(formatRelative('2026-10-06T10:00:10Z', now)).toBe('now');
    expect(formatRelative('2026-10-06T10:45:00Z', now)).toBe('in 45m');
    expect(formatRelative('2026-10-06T12:05:00Z', now)).toBe('in 2h 5m');
    expect(formatRelative('2026-10-08T10:00:00Z', now)).toBe('in 2 days');
  });

  it('converts a local datetime to ISO', () => {
    expect(localToIso('')).toBeNull();
    expect(localToIso('2030-01-02T03:04')).toBe(new Date('2030-01-02T03:04').toISOString());
  });
});
