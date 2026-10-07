import { expect, it } from 'vitest';
import { splitDiff } from './diff.ts';

it('splits a unified diff per file', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/b.txt b/b.txt',
    'new file mode 100644',
    '+x',
    '',
  ].join('\n');
  const files = splitDiff(diff);
  expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'b.txt']);
  expect(files[0]?.text).toContain('+new');
  expect(files[0]?.text).not.toContain('b.txt');
  expect(splitDiff('')).toEqual([]);
});
