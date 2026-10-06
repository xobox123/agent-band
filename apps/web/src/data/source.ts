import type { BoardEvent, BoardFilter, BoardSnapshot, NewTask, Priority } from './types.ts';

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
}

export const emptyFilter: BoardFilter = { text: '', agentId: null, label: null, accountId: null };
