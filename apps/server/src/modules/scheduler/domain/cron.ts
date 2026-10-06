import { CronExpressionParser } from 'cron-parser';
import { invalid } from '../../../platform/errors.ts';

export const PREVIEW_COUNT = 5;

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw invalid([{ path: 'timezone', message: `unknown time zone ${timezone}` }]);
  }
}

function parse(cron: string, timezone: string, after: Date) {
  assertTimezone(timezone);
  if (cron.trim().split(/\s+/).length !== 5)
    throw invalid([{ path: 'cron', message: 'must have exactly 5 fields' }]);
  try {
    return CronExpressionParser.parse(cron.trim(), { currentDate: after, tz: timezone });
  } catch (err) {
    throw invalid([
      { path: 'cron', message: err instanceof Error ? err.message : 'invalid cron expression' },
    ]);
  }
}

/** Throws a validation error unless `cron` is a five-field expression that fires in `timezone`. */
export function validateCron(cron: string, timezone: string, now: Date = new Date()): void {
  nextFire(cron, timezone, now);
}

/** First fire strictly after `after`; a missed window yields one fire, never a backlog. */
export function nextFire(cron: string, timezone: string, after: Date): Date {
  const it = parse(cron, timezone, after);
  try {
    return it.next().toDate();
  } catch {
    throw invalid([{ path: 'cron', message: 'expression never fires' }]);
  }
}

export function nextFires(cron: string, timezone: string, after: Date, count = PREVIEW_COUNT): Date[] {
  const it = parse(cron, timezone, after);
  const result: Date[] = [];
  try {
    for (let i = 0; i < count; i++) result.push(it.next().toDate());
  } catch {
    if (result.length === 0) throw invalid([{ path: 'cron', message: 'expression never fires' }]);
  }
  return result;
}
