import { expect, it } from 'vitest';
import { findingsFeedback, parseVerdict, reviewerPrompt } from './verdict.ts';

it('reads an approval and ignores the "none" finding', () => {
  expect(parseVerdict('VERDICT: APPROVE\nFINDINGS:\n- none')).toEqual({ verdict: 'APPROVE', findings: [] });
});

it('reads requested changes with bulleted and numbered findings', () => {
  const text = [
    '**VERDICT: CHANGES REQUESTED**',
    'FINDINGS:',
    '- src/a.ts:3 missing check',
    '* src/b.ts:9 wrong status code',
    '2. add a test for the refusal',
    'Some prose that is not a finding.',
  ].join('\n');
  expect(parseVerdict(text)).toEqual({
    verdict: 'CHANGES REQUESTED',
    findings: ['src/a.ts:3 missing check', 'src/b.ts:9 wrong status code', 'add a test for the refusal'],
  });
});

it('is case insensitive and finds the verdict after a preamble', () => {
  expect(parseVerdict('Looked at it.\n\nverdict: approve')?.verdict).toBe('APPROVE');
});

it('returns nothing without a valid verdict line', () => {
  expect(parseVerdict('Looks fine to me')).toBeUndefined();
  expect(parseVerdict('VERDICT: MAYBE')).toBeUndefined();
  expect(parseVerdict('I would say the verdict: approve is wrong')).toBeUndefined();
});

it('builds the standard prompt with the format and the reviewed commit', () => {
  const prompt = reviewerPrompt({
    key: 'AB-1',
    title: 'T',
    branch: 'ab/AB-1',
    base: 'main',
    sha: 'abc123',
    prompt: 'Do it',
  });
  expect(prompt).toContain('VERDICT: APPROVE or VERDICT: CHANGES REQUESTED');
  expect(prompt).toContain('abc123');
  expect(prompt).toContain('Original task:\nDo it');
});

it('turns findings into feedback', () => {
  expect(findingsFeedback(['a', 'b'])).toBe('- a\n- b');
  expect(findingsFeedback([])).toContain('without listing findings');
});
