import { useMemo, useState } from 'react';
import type { Priority } from '../../data/types.ts';
import { BoardColumn } from './BoardColumn.tsx';
import { COLUMNS, laneOf, sortQueued, sortRecent } from './model.ts';
import type { TaskView } from './model.ts';
import type { DndApi } from './dndApi.ts';

interface Props {
  views: TaskView[];
  swimlanes: boolean;
  now: number;
  selectedId: string | null;
  pendingIds: Set<string>;
  dnd: DndApi;
  onOpen: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: Priority) => void;
  onCancel: (taskId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

export const NO_LANE = '__all';

export function BoardColumns({ views, swimlanes, ...rest }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const lanes = useMemo(() => {
    if (!swimlanes) return [{ key: NO_LANE, name: '', views }];
    const map = new Map<string, { key: string; name: string; views: TaskView[] }>();
    for (const v of views) {
      const lane = laneOf(v);
      const entry = map.get(lane.key) ?? { ...lane, views: [] };
      entry.views.push(v);
      map.set(lane.key, entry);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === '__unassigned') return 1;
      if (b.key === '__unassigned') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [views, swimlanes]);

  const renderColumns = (laneKey: string, laneViews: TaskView[]) => (
    <div className="columns">
      {COLUMNS.map((column) => {
        const inColumn = laneViews.filter((v) => column.statuses.includes(v.task.status));
        const sorted =
          column.id === 'queued'
            ? sortQueued(inColumn.map((v) => v.task))
            : sortRecent(inColumn.map((v) => v.task));
        const byId = new Map(inColumn.map((v) => [v.task.id, v]));
        const ordered = sorted.flatMap((t) => byId.get(t.id) ?? []);
        return <BoardColumn key={column.id} column={column} views={ordered} laneKey={laneKey} {...rest} />;
      })}
    </div>
  );

  if (!swimlanes) return <div className="board-scroll">{renderColumns(NO_LANE, views)}</div>;

  return (
    <div className="board-scroll">
      {lanes.map((lane) => {
        const isCollapsed = collapsed.has(lane.key);
        return (
          <section key={lane.key} className="lane" aria-label={`Lane ${lane.name}`}>
            <h2 className="lane-head">
              <button
                type="button"
                className="lane-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => {
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(lane.key)) next.delete(lane.key);
                    else next.add(lane.key);
                    return next;
                  });
                }}
              >
                <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {lane.name}
              </button>
              <span className="count">{lane.views.length}</span>
            </h2>
            {isCollapsed ? null : renderColumns(lane.key, lane.views)}
          </section>
        );
      })}
    </div>
  );
}
