import { describe, expect, it } from 'vitest';
import { isPathAllowed, isPathWithin } from './paths.ts';

describe('isPathWithin', () => {
  it.each([
    ['/repo/a', '/repo', true],
    ['/repo', '/repo', true],
    ['/repo/', '/repo', true],
    ['/repo/a/', '/repo/', true],
    ['/repo//a/./b', '/repo', true],
    ['/repo/a/../b', '/repo', true],
    ['/repo2', '/repo', false],
    ['/repo-x/a', '/repo', false],
    ['/repo/../etc', '/repo', false],
    ['/repo/a/../../etc', '/repo', false],
    ['/etc', '/repo', false],
    ['/anything', '/', true],
    ['repo/a', '/repo', false],
    ['./repo/a', '/repo', false],
    ['/repo/a', 'repo', false],
    ['', '/repo', false],
    ['/repo/a\0b', '/repo', false],
  ])('(%j, %j) -> %s', (target, root, expected) => {
    expect(isPathWithin(target, root)).toBe(expected);
  });
});

describe('isPathAllowed', () => {
  it('allows everything when there are no sets', () => {
    expect(isPathAllowed('/anywhere', [])).toBe(true);
  });

  it('requires every set to contain the target', () => {
    const sets = [['/work'], ['/work/repo']];
    expect(isPathAllowed('/work/repo/src', sets)).toBe(true);
    expect(isPathAllowed('/work/other', sets)).toBe(false);
    expect(isPathAllowed('/work', sets)).toBe(false);
  });

  it('accepts any root within a set', () => {
    expect(isPathAllowed('/b/x', [['/a', '/b']])).toBe(true);
    expect(isPathAllowed('/c/x', [['/a', '/b']])).toBe(false);
  });

  it('denies everything for an empty set', () => {
    expect(isPathAllowed('/a', [[]])).toBe(false);
  });
});
