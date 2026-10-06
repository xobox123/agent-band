export const runStatuses = ['running', 'done', 'failed', 'rate_limited', 'cancelled'] as const;
export type RunStatus = (typeof runStatuses)[number];
export interface SkillSnapshot {
  skillId: string;
  version: number;
  contentHash: string;
}
export interface StartRunInput {
  taskId: string;
  agentId: string;
  accountId: string;
  workerId: string;
  effectivePolicy: Record<string, unknown>;
  skills: SkillSnapshot[];
}
export interface FinishRunInput {
  status: Exclude<RunStatus, 'running'>;
  exitCode?: number | null;
  error?: string;
  rateLimitResetsAt?: Date | null;
}
export interface UsageScope {
  agentId?: string;
  accountId?: string;
}
