import { describe, expect, it } from 'vitest';
import type { Task } from '../../data/types.ts';
import { FRESH_MS, cardTone } from './model.ts';

const NOW = Date.parse('2026-10-14T12:00:00Z');

function task(status: Task['status'], createdAgoMs: number): Task {
  return { status, createdAt: new Date(NOW - createdAgoMs).toISOString() } as Task;
}

describe('cardTone', () => {
  it('maps live and finished statuses to frame tones', () => {
    expect(cardTone(task('running', 0), NOW)).toBe('running');
    expect(cardTone(task('claimed', 0), NOW)).toBe('running');
    expect(cardTone(task('rate_limited', 0), NOW)).toBe('warn');
    expect(cardTone(task('failed', 0), NOW)).toBe('crit');
    expect(cardTone(task('denied', 0), NOW)).toBe('crit');
    expect(cardTone(task('done', 0), NOW)).toBe('ok');
  });

  it('marks recent unstarted tasks as new and ages them out', () => {
    expect(cardTone(task('queued', 60_000), NOW)).toBe('new');
    expect(cardTone(task('draft', 60_000), NOW)).toBe('new');
    expect(cardTone(task('queued', FRESH_MS), NOW)).toBe('none');
    expect(cardTone(task('queued', FRESH_MS + 1), NOW)).toBe('none');
  });

  it('never marks cancelled tasks or future timestamps as new', () => {
    expect(cardTone(task('cancelled', 1000), NOW)).toBe('none');
    expect(cardTone(task('queued', -1000), NOW)).toBe('none');
  });
});
