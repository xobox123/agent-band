import { expect, it } from 'vitest';
import {
  DocsOnlyChecks,
  expandChangedFiles,
  feedbackPrompt,
  parseNumstat,
  selectChecks,
  slugOf,
  summarizeStat,
  tailBytes,
} from './project.ts';

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

describe('docs-only check selection', () => {
  const full = ['npm run lint', 'npm test'];
  const docs = DocsOnlyChecks.parse({});

  it('defaults to the expected paths and check command', () => {
    expect(docs).toEqual({
      paths: ['**/*.md', 'docs/**', 'handoff/**'],
      checks: ['npx prettier --check <changed files>'],
    });
  });

  it('uses docs checks for documentation-only changes, including root and nested files', () => {
    const chosen = selectChecks(full, docs, [
      'README.md',
      'docs/api/openapi.yaml',
      'handoff/chatgpt/inbox/task.txt',
      'docs/nested/README.md',
    ]);
    expect(chosen).toMatchObject({ checkSet: 'docs', commands: docs.checks });
    expect(chosen.checkReason).toContain('4 changed files');
  });

  it('uses full checks for mixed diffs, absent setting and an empty diff', () => {
    expect(selectChecks(full, docs, ['docs/README.md', 'src/index.ts'])).toMatchObject({
      checkSet: 'full',
      commands: full,
    });
    expect(selectChecks(full, null, ['README.md'])).toMatchObject({ checkSet: 'full', commands: full });
    expect(selectChecks(full, docs, [])).toMatchObject({ checkSet: 'full', commands: full });
  });

  it('matches glob boundaries and wildcard edge cases without broadening scope', () => {
    const setting = DocsOnlyChecks.parse({ paths: ['doc/*.md', 'exact.txt', '**/README.?d'] });
    expect(selectChecks(full, setting, ['doc/a.md', 'exact.txt', 'README.md'] ).checkSet).toBe('docs');
    expect(selectChecks(full, setting, ['doc/nested/a.md']).checkSet).toBe('full');
    expect(selectChecks(full, setting, ['doc/a.md.txt']).checkSet).toBe('full');
    expect(selectChecks(full, setting, ['myexact.txt']).checkSet).toBe('full');
  });

  it('quotes changed filenames safely when interpolating check commands', () => {
    const command = expandChangedFiles('npx prettier --check <changed files>', [
      'README.md',
      "docs/a'b file.md",
    ]);
    expect(command).toContain("-- 'README.md'");
    expect(command).toContain("docs/a'\\''b file.md");
    expect(command).not.toContain('<changed files>');
  });
});
