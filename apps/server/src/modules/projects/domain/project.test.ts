import { expect, it } from 'vitest';
import { feedbackPrompt, parseNumstat, reviewerPrompt, slugOf, summarizeStat, tailBytes } from './project.ts';

it('derives slugs', () => {
  expect(slugOf('Agent Band!')).toBe('agent-band');
  expect(slugOf('!!!')).toBe('project');
});

it('parses numstat output including binary files and tabs in names', () => {
  const files = parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg.png\n0\t2\tdir/with\ttab.txt\n');
  expect(files).toEqual([
    { path: 'src/a.ts', additions: 3, deletions: 1 },
    { path: 'img.png', additions: 0, deletions: 0 },
    { path: 'dir/with\ttab.txt', additions: 0, deletions: 2 },
  ]);
  expect(summarizeStat(files)).toEqual({ files: 3, additions: 3, deletions: 3 });
});

it('keeps the tail of long output without splitting characters', () => {
  expect(tailBytes('abcdef', 3)).toBe('def');
  expect(tailBytes('abc', 10)).toBe('abc');
  expect(tailBytes('aéé', 3)).toBe('é');
});

it('appends feedback to the prompt', () => {
  expect(feedbackPrompt('Do it', 'Add tests', 2)).toContain('Do it\n\nReviewer feedback (attempt 2)');
  expect(feedbackPrompt('Do it', 'Add tests', 2)).toContain('Add tests');
});

const reviewed = {
  key: 'AB-1',
  title: 'Add x',
  prompt: 'Do x.\nAcceptance: y',
  branch: 'b',
  baseBranch: 'main',
};

it('puts the original task into the reviewer prompt', () => {
  const p = reviewerPrompt(reviewed, null);
  expect(p).toContain('Reviewed task: AB-1');
  expect(p).toContain('Original task title: Add x');
  expect(p).toContain('Acceptance: y');
  expect(p).not.toContain('Latest reviewer feedback');
});

it('keeps custom reviewer instructions and adds the latest feedback', () => {
  const p = reviewerPrompt(reviewed, 'fix z', 'Check security only.');
  expect(p.startsWith('Check security only.')).toBe(true);
  expect(p).toContain('Do x.');
  expect(p).toContain('fix z');
});
