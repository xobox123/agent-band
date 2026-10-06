import { describe, expect, it } from 'vitest';
import { nextFire, nextFires, validateCron } from './cron.ts';

const WARSAW = 'Europe/Warsaw';
const iso = (d: Date) => d.toISOString();

describe('cron next fire', () => {
  it('fires in the given time zone', () => {
    expect(iso(nextFire('0 9 * * *', WARSAW, new Date('2026-01-10T00:00:00Z')))).toBe(
      '2026-01-10T08:00:00.000Z',
    );
    expect(iso(nextFire('0 9 * * *', WARSAW, new Date('2026-07-10T00:00:00Z')))).toBe(
      '2026-07-10T07:00:00.000Z',
    );
  });

  it('is strictly after the reference time', () => {
    const at = new Date('2026-01-10T08:00:00Z');
    expect(iso(nextFire('0 9 * * *', WARSAW, at))).toBe('2026-01-11T08:00:00.000Z');
  });

  it('spring forward: a fire in the skipped hour runs once, the day before and after are normal', () => {
    const fires = nextFires('30 2 * * *', WARSAW, new Date('2026-03-27T12:00:00Z'), 4).map(iso);
    expect(fires).toEqual([
      '2026-03-28T01:30:00.000Z',
      '2026-03-29T01:30:00.000Z',
      '2026-03-30T00:30:00.000Z',
      '2026-03-31T00:30:00.000Z',
    ]);
  });

  it('spring forward: a daily fire keeps its local hour across the change', () => {
    const fires = nextFires('0 9 * * *', WARSAW, new Date('2026-03-27T12:00:00Z'), 3).map(iso);
    expect(fires).toEqual([
      '2026-03-28T08:00:00.000Z',
      '2026-03-29T07:00:00.000Z',
      '2026-03-30T07:00:00.000Z',
    ]);
  });

  it('fall back: a fire in the repeated hour runs once', () => {
    const fires = nextFires('30 2 * * *', WARSAW, new Date('2026-10-23T12:00:00Z'), 4).map(iso);
    expect(fires).toEqual([
      '2026-10-24T00:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
      '2026-10-27T01:30:00.000Z',
    ]);
  });

  it('fall back: a daily fire keeps its local hour across the change', () => {
    const fires = nextFires('0 9 * * *', WARSAW, new Date('2026-10-23T12:00:00Z'), 3).map(iso);
    expect(fires).toEqual([
      '2026-10-24T07:00:00.000Z',
      '2026-10-25T08:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
    ]);
  });

  it('returns the requested number of fires', () => {
    expect(nextFires('*/15 * * * *', 'UTC', new Date('2026-01-01T00:00:00Z'))).toHaveLength(5);
  });
});

describe('cron validation', () => {
  it.each(['', '* * * *', '* * * * * *', '61 * * * *', 'abc', '@daily', '0 0 31 2 *'])(
    'rejects %j',
    (cron) => {
      expect(() => {
        validateCron(cron, 'UTC');
      }).toThrow(expect.objectContaining({ status: 400 }) as Error);
    },
  );

  it('rejects an unknown time zone', () => {
    expect(() => {
      validateCron('0 0 * * *', 'Mars/Base');
    }).toThrow(expect.objectContaining({ status: 400 }) as Error);
  });

  it('accepts common expressions', () => {
    for (const cron of ['* * * * *', '0 9 * * 1-5', '*/10 8-18 * * mon-fri', '0 0 1 * *'])
      expect(() => {
        validateCron(cron, WARSAW);
      }).not.toThrow();
  });
});
