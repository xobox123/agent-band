import { reviewerVerdicts, type ReviewerVerdict } from '../../tasks/index.ts';

export interface ParsedVerdict {
  verdict: ReviewerVerdict;
  findings: string[];
}

const VERDICT_LINE = /^[\s*_`#>-]*VERDICT\s*:\s*(APPROVE|CHANGES REQUESTED)\b/im;
const BULLET = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/;

/** Reads `VERDICT: APPROVE|CHANGES REQUESTED` and the bullet list of findings from a reviewer's reply. */
export function parseVerdict(text: string): ParsedVerdict | undefined {
  const word = VERDICT_LINE.exec(text)?.[1]?.toUpperCase();
  const verdict = reviewerVerdicts.find((v) => v === word);
  if (!verdict) return undefined;
  const findings: string[] = [];
  for (const line of text.split('\n')) {
    const bullet = BULLET.exec(line)?.[1];
    if (bullet && !/^none\.?$/i.test(bullet) && !VERDICT_LINE.test(line)) findings.push(bullet);
  }
  return { verdict, findings: findings.slice(0, 50) };
}

export function reviewerPrompt(input: {
  key: string;
  title: string;
  branch: string;
  base: string;
  sha: string;
  prompt: string;
}): string {
  return [
    `Review the changes of ${input.key} (${input.title}) in this worktree.`,
    `They are the commits on branch ${input.branch} that are not in ${input.base}, up to commit ${input.sha}.`,
    'Do not modify files. Check correctness, tests and the rules in AGENTS.md.',
    'Reply in exactly this format:',
    'VERDICT: APPROVE or VERDICT: CHANGES REQUESTED (first line)',
    'FINDINGS:',
    '- one bullet per problem, by file and line, with what to change (write "- none" when approving)',
    `Original task:\n${input.prompt}`,
  ].join('\n');
}

export function findingsFeedback(findings: string[]): string {
  return findings.length > 0
    ? findings.map((f) => `- ${f}`).join('\n')
    : 'The reviewer requested changes without listing findings.';
}
