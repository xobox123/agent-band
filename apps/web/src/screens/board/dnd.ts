import type { Task } from '../../data/types.ts';
import { CANCELLABLE, columnOf, restorable } from './model.ts';
import type { ColumnId } from './model.ts';

export type DropTarget =
  | { kind: 'card'; task: Task; laneKey: string }
  | { kind: 'band'; priority: Task['priority']; laneKey: string }
  | { kind: 'column'; column: ColumnId; laneKey: string };

export type DropResult =
  | { kind: 'reorder'; beforeId: string | null }
  | { kind: 'cancel' }
  | { kind: 'backlog' }
  | { kind: 'none' }
  | { kind: 'reject'; reason: string };

export const MSG_NO_REASSIGN = 'Dragging cannot reassign tasks.';
export const MSG_USE_PRIORITY = 'Use Set priority to change priority.';
export const MSG_ONLY_QUEUED = 'Only queued tasks can be reordered.';

export function evaluateDrop(dragged: Task, dragLane: string, target: DropTarget): DropResult {
  if (target.laneKey !== dragLane) return { kind: 'reject', reason: MSG_NO_REASSIGN };

  const column =
    target.kind === 'card' ? columnOf(target.task.status) : target.kind === 'band' ? 'queued' : target.column;

  if (column === 'cancelled') {
    return CANCELLABLE.includes(dragged.status)
      ? { kind: 'cancel' }
      : {
          kind: 'reject',
          reason: 'Only scheduled, queued, claimed, running or rate-limited tasks can be cancelled.',
        };
  }

  if (column === 'draft') {
    return restorable(dragged)
      ? { kind: 'backlog' }
      : {
          kind: 'reject',
          reason: 'Only done, failed, denied, cancelled or rate-limited tasks can move to the backlog.',
        };
  }

  if (column === 'queued') {
    if (dragged.status !== 'queued') return { kind: 'reject', reason: MSG_ONLY_QUEUED };
    if (target.kind === 'column') return { kind: 'none' };
    const priority = target.kind === 'card' ? target.task.priority : target.priority;
    if (priority !== dragged.priority) return { kind: 'reject', reason: MSG_USE_PRIORITY };
    if (target.kind === 'card') {
      return target.task.id === dragged.id ? { kind: 'none' } : { kind: 'reorder', beforeId: target.task.id };
    }
    return { kind: 'reorder', beforeId: null };
  }

  if (dragged.status !== 'queued' && columnOf(dragged.status) === column) return { kind: 'none' };
  return {
    kind: 'reject',
    reason: 'This move is not allowed. Only reordering within Queued and cancelling are supported.',
  };
}
