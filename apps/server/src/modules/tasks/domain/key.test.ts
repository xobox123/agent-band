import { describe, expect, it } from 'vitest';
import { formatTaskKey } from './key.ts';

describe('formatTaskKey', () => {
  it('joins prefix and sequence', () => {
    expect(formatTaskKey('AB', 42)).toBe('AB-42');
    expect(formatTaskKey('A1B2C3D4E5', 1)).toBe('A1B2C3D4E5-1');
  });

  it.each(['', 'A', 'ab', '1AB', 'A-B', 'ABCDEFGHIJK', 'AB '])('rejects prefix %j', (p) => {
    expect(() => formatTaskKey(p, 1)).toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects seq %s', (n) => {
    expect(() => formatTaskKey('AB', n)).toThrow();
  });
});
