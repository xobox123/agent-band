import { z } from 'zod';
export const taskStatuses = [
  'queued',
  'claimed',
  'running',
  'done',
  'failed',
  'rate_limited',
  'cancelled',
  'denied',
] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const TaskTarget = z.union([
  z.object({ agentId: z.uuid() }).strict(),
  z.object({ label: z.string().min(1) }).strict(),
  z.object({ agentGroupId: z.uuid() }).strict(),
]);
export type TaskTarget = z.infer<typeof TaskTarget>;
export const CreateTask = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  workDir: z.string().startsWith('/'),
  target: TaskTarget,
  priority: z.number().int().min(0).max(3).default(2),
  rank: z.number().default(0),
  mode: z.enum(['read-only', 'edit', 'full-auto']).optional(),
});
export type CreateTaskInput = z.input<typeof CreateTask>;
export const boardColumns = ['queued', 'running', 'rate_limited', 'done', 'failed', 'cancelled'] as const;
export function boardColumn(status: TaskStatus): (typeof boardColumns)[number] {
  return status === 'claimed' ? 'running' : status === 'denied' ? 'failed' : status;
}
export function resource(target: TaskTarget) {
  return 'agentId' in target
    ? { agentId: target.agentId }
    : 'agentGroupId' in target
      ? { agentGroupIds: [target.agentGroupId] }
      : {};
}
