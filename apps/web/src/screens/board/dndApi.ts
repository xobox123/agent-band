import type { DragEvent } from 'react';
import type { Task } from '../../data/types.ts';
import type { DropTarget } from './dnd.ts';

export interface DndHint {
  key: string;
  ok: boolean;
  reason: string | null;
}

export interface DndApi {
  draggingId: string | null;
  hint: DndHint | null;
  start: (task: Task, laneKey: string, event: DragEvent) => void;
  over: (key: string, target: DropTarget, event: DragEvent) => void;
  drop: (target: DropTarget, event: DragEvent) => void;
  end: () => void;
}

export function targetKey(target: DropTarget): string {
  if (target.kind === 'card') return `card:${target.task.id}`;
  if (target.kind === 'band') return `band:${target.laneKey}:${String(target.priority)}`;
  return `col:${target.laneKey}:${target.column}`;
}
