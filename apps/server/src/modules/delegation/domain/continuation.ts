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

export interface RejectedPlanItem {
  key: string;
  title: string;
  dependsOn: string[];
}

/** Prompt for the planning turn that follows a rejected plan; the feedback is part of the instructions. */
export function buildRejectionPrompt(input: {
  goalPrompt: string;
  round: number;
  maxRounds: number;
  feedback: string;
  rejected: RejectedPlanItem[];
  children: ChildSummary[];
}): string {
  const lines = [
    input.goalPrompt,
    '',
    '---',
    `Planning turn ${input.round} of at most ${input.maxRounds}. Your previous plan was rejected by the human reviewer.`,
    '',
    'Reviewer feedback:',
    input.feedback,
    '',
  ];
  if (input.rejected.length > 0) {
    lines.push('The rejected plan (these subtasks were discarded):');
    for (const r of input.rejected)
      lines.push(`- ${r.title}${r.dependsOn.length > 0 ? ` (depends on ${r.dependsOn.join(', ')})` : ''}`);
    lines.push('');
  }
  if (input.children.length > 0) {
    lines.push('Work that already ran:');
    for (const c of input.children) {
      lines.push(
        `[${c.key}] ${c.title} (${c.kind}) status: ${c.status}${c.outcome ? `, outcome: ${c.outcome}` : ''}`,
      );
      if (c.summary) lines.push(`summary: ${c.summary.replace(/\n/g, '\n  ')}`);
    }
    lines.push('');
  }
  lines.push(
    'Revise the plan to address the feedback: create the new subtasks with create_subtask and end your turn. A human approves the plan before anything runs.',
  );
  return lines.join('\n');
}
