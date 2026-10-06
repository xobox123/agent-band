export interface ChildSummary {
  key: string;
  title: string;
  kind: string;
  status: string;
  outcome?: string;
  summary?: string;
  error?: string;
  dependsOn: string[];
}

export function buildContinuationPrompt(input: {
  goalPrompt: string;
  round: number;
  maxRounds: number;
  children: ChildSummary[];
}): string {
  const lines = [
    input.goalPrompt,
    '',
    '---',
    `Continuation turn ${input.round} of at most ${input.maxRounds}.`,
    input.children.length === 0
      ? 'You have not delegated any subtasks yet.'
      : 'All delegated work has finished. Results so far:',
    '',
  ];
  for (const c of input.children) {
    lines.push(`[${c.key}] ${c.title} (${c.kind})`);
    lines.push(`status: ${c.status}${c.outcome ? `, outcome: ${c.outcome}` : ''}`);
    if (c.dependsOn.length > 0) lines.push(`depends on: ${c.dependsOn.join(', ')}`);
    if (c.error) lines.push(`error: ${c.error}`);
    if (c.summary) lines.push(`summary: ${c.summary.replace(/\n/g, '\n  ')}`);
    lines.push('');
  }
  lines.push(
    'Decide the next step: create more subtasks, request a review, or finish by calling complete_goal.',
  );
  return lines.join('\n');
}
