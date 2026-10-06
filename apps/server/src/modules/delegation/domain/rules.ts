import { z } from 'zod';
import { minMode, type DelegateTargets, type Mode } from '../../policy/index.ts';
import { TaskTarget } from '../../tasks/index.ts';

export interface TargetableAgent {
  id: string;
  labels: string[];
  groupIds: string[];
}

/** An agent must satisfy every dimension the policy sets; unset dimensions do not restrict. */
export function agentAllowed(targets: DelegateTargets | undefined, agent: TargetableAgent): boolean {
  if (!targets) return true;
  if (targets.agentIds && !targets.agentIds.includes(agent.id)) return false;
  if (targets.labels && !agent.labels.some((l) => targets.labels?.includes(l))) return false;
  if (targets.groupIds && !agent.groupIds.some((g) => targets.groupIds?.includes(g))) return false;
  return true;
}

/** A subtask never gets more than the leader's policy cap or the mode the leader itself runs in. */
export function capSubtaskMode(requested: Mode | undefined, leaderRunMode: Mode, leaderMaxMode: Mode): Mode {
  return minMode(minMode(requested ?? leaderRunMode, leaderMaxMode), leaderRunMode);
}

const minOf = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

export function effectiveLimit(goalLimit: number | undefined, policyLimit: number | undefined) {
  return minOf(goalLimit, policyLimit);
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const CreateSubtaskInput = z
  .object({
    title: text(200),
    prompt: z.string().min(1).max(100_000),
    workDir: z.string().startsWith('/').max(4096),
    target: TaskTarget,
    priority: z.number().int().min(0).max(3).optional(),
    mode: z.enum(['read-only', 'edit', 'full-auto']).optional(),
    /** Keys (or ids) of earlier subtasks of the same goal. */
    dependsOn: z.array(text(100)).max(50).optional(),
  })
  .strict();
export type CreateSubtaskInput = z.input<typeof CreateSubtaskInput>;

export const RequestReviewInput = z
  .object({
    subtaskKey: text(100),
    reviewerTarget: TaskTarget,
    instructions: z.string().min(1).max(20_000),
  })
  .strict();
export type RequestReviewInput = z.input<typeof RequestReviewInput>;

export const CompleteGoalInput = z
  .object({
    summary: z.string().min(1).max(50_000),
    outcome: z.enum(['success', 'partial', 'failed']),
  })
  .strict();
export type CompleteGoalInput = z.input<typeof CompleteGoalInput>;

export const DelegateAgentFilter = z
  .object({
    label: z.string().min(1).optional(),
    role: z.enum(['worker', 'reviewer']).optional(),
  })
  .strict();
export type DelegateAgentFilter = z.input<typeof DelegateAgentFilter>;
