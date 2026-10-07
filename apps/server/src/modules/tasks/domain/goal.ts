import { z } from 'zod';

export const taskKinds = ['task', 'goal', 'review'] as const;
export type TaskKind = (typeof taskKinds)[number];

export const goalStatuses = [
  'planning',
  'awaiting_approval',
  'waiting',
  'continuing',
  'completed',
  'failed',
] as const;
export const goalApprovals = ['auto', 'required'] as const;
export type GoalApproval = (typeof goalApprovals)[number];
export type GoalStatus = (typeof goalStatuses)[number];

export const taskOutcomes = ['success', 'partial', 'failed', 'cancelled'] as const;
export type TaskOutcome = (typeof taskOutcomes)[number];

export interface TaskResult {
  summary: string;
  outcome: TaskOutcome;
}

export const RESULT_SUMMARY_MAX_BYTES = 4096;

export const GoalLimitsInput = z
  .object({
    maxRounds: z.number().int().min(1).max(100).optional(),
    maxSubtasks: z.number().int().min(1).max(500).optional(),
    treeTokenBudget: z.number().int().positive().optional(),
  })
  .strict();

export interface GoalLimits {
  maxRounds: number;
  maxSubtasks: number;
  treeTokenBudget?: number;
}

export const DEFAULT_MAX_ROUNDS = 5;
export const DEFAULT_MAX_SUBTASKS = 20;
export const MAX_DEPTH = 1;

export function resolveGoalLimits(input: z.infer<typeof GoalLimitsInput> | undefined): GoalLimits {
  return {
    maxRounds: input?.maxRounds ?? DEFAULT_MAX_ROUNDS,
    maxSubtasks: input?.maxSubtasks ?? DEFAULT_MAX_SUBTASKS,
    ...(input?.treeTokenBudget !== undefined && { treeTokenBudget: input.treeTokenBudget }),
  };
}

export interface GoalNote {
  at: string;
  runId: string;
  text: string;
}

export const terminalStatuses = ['done', 'failed', 'cancelled', 'denied'] as const;

/** Truncates to a UTF-8 byte budget without splitting a character. */
export function truncateBytes(text: string, max: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return text;
  let end = max;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

export interface Eligibility {
  reason: string;
  checkedAt: string;
  nextCheckAt: string;
  /** Consecutive failed checks with this reason; drives the backoff. */
  checks: number;
}
