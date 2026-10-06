export { createTasks, type ChildPlacement, type TasksDeps, type TaskFilter } from './app/tasks.ts';
export type { Task, GoalState } from './infra/schema.ts';
export { TaskTarget } from './domain/task.ts';
export type { CreateTaskInput, TaskStatus } from './domain/task.ts';
export { formatTaskKey } from './domain/key.ts';
export {
  MAX_DEPTH,
  RESULT_SUMMARY_MAX_BYTES,
  GoalLimitsInput,
  goalStatuses,
  terminalStatuses,
  truncateBytes,
  type Eligibility,
  type GoalLimits,
  type GoalNote,
  type GoalStatus,
  type TaskKind,
  type TaskOutcome,
  type TaskResult,
} from './domain/goal.ts';
