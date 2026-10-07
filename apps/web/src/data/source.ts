import type {
  BoardEvent,
  BoardFilter,
  BoardSnapshot,
  NewTask,
  Priority,
  StartWhen,
  TaskPatch,
} from './types.ts';

export interface BoardDataSource {
  load(filter: BoardFilter): Promise<BoardSnapshot>;
  subscribe(fn: (event: BoardEvent) => void): () => void;
  /**
   * Moves a queued task inside its priority band, before `beforeId`
   * (or to the end of the band when null). Only rank changes.
   * Rejects with a user-readable Error.
   */
  reorder(taskId: string, beforeId: string | null): Promise<void>;
  setPriority(taskId: string, priority: Priority): Promise<void>;
  cancel(taskId: string): Promise<void>;
  createTask(task: NewTask): Promise<void>;
  /** Moves backlog tasks to the queue, all or none. */
  startTasks(ids: string[], when: StartWhen): Promise<void>;
  /** Moves failed, denied, cancelled or rate-limited tasks back to the backlog, all or none. */
  toBacklog(ids: string[]): Promise<void>;
  updateTask(taskId: string, patch: TaskPatch): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  approvePlan(goalId: string, when: StartWhen): Promise<void>;
  rejectPlan(goalId: string, feedback: string): Promise<void>;
  addPlanTask(goalId: string, task: NewTask): Promise<void>;
}

export const emptyFilter: BoardFilter = { text: '', agentId: null, label: null, accountId: null };
