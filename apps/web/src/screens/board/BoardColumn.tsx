import { useState } from 'react';
import type { Priority } from '../../data/types.ts';
import { TaskCard } from './TaskCard.tsx';
import { targetKey } from './dndApi.ts';
import type { DndApi } from './dndApi.ts';
import type { ColumnDef, TaskView } from './model.ts';

const PAGE = 50;

interface Props {
  column: ColumnDef;
  views: TaskView[];
  laneKey: string;
  now: number;
  selectedId: string | null;
  pendingIds: Set<string>;
  dnd: DndApi;
  onOpen: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: Priority) => void;
  onCancel: (taskId: string) => void;
  onOpenAgent: (agentId: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function BoardColumn({
  column,
  views,
  laneKey,
  now,
  selectedId,
  pendingIds,
  dnd,
  onOpen,
  onSetPriority,
  onCancel,
  onOpenAgent,
  collapsed = false,
  onToggleCollapsed,
}: Props) {
  const [limit, setLimit] = useState(PAGE);
  const expanded = !collapsed;
  const shown = views.slice(0, limit);
  const colTarget = { kind: 'column', column: column.id, laneKey } as const;
  const colKey = targetKey(colTarget);
  const colHint = dnd.hint?.key === colKey ? dnd.hint : null;

  const card = (view: TaskView) => (
    <TaskCard
      key={view.task.id}
      view={view}
      laneKey={laneKey}
      now={now}
      selected={selectedId === view.task.id}
      pending={pendingIds.has(view.task.id)}
      dnd={dnd}
      onOpen={onOpen}
      onSetPriority={onSetPriority}
      onCancel={onCancel}
      onOpenAgent={onOpenAgent}
    />
  );

  let body;
  if (shown.length === 0) {
    body = <p className="column-empty dim">{column.empty}</p>;
  } else if (column.id === 'queued') {
    const bands = ([0, 1, 2, 3] as Priority[]).filter((p) => shown.some((v) => v.task.priority === p));
    body = bands.map((p) => {
      const target = { kind: 'band', priority: p, laneKey } as const;
      const key = targetKey(target);
      const hint = dnd.hint?.key === key ? dnd.hint : null;
      return (
        <section
          key={p}
          className={`band${hint ? (hint.ok ? ' drop-ok' : ' drop-bad') : ''}`}
          aria-label={`Priority P${String(p)}`}
          onDragOver={(e) => {
            e.stopPropagation();
            dnd.over(key, target, e);
          }}
          onDrop={(e) => {
            e.stopPropagation();
            dnd.drop(target, e);
          }}
        >
          <h3 className="band-title dim">{`P${String(p)}`}</h3>
          {shown.filter((v) => v.task.priority === p).map(card)}
        </section>
      );
    });
  } else {
    body = shown.map(card);
  }

  return (
    <section
      className={`column${expanded ? '' : ' is-collapsed'}${colHint ? (colHint.ok ? ' drop-ok' : ' drop-bad') : ''}`}
      aria-label={column.title}
      data-column={column.id}
      onDragOver={(e) => {
        dnd.over(colKey, colTarget, e);
      }}
      onDrop={(e) => {
        dnd.drop(colTarget, e);
      }}
    >
      <header className="column-head">
        <h2 className="column-title">{column.title}</h2>
        <span className="count" aria-label={`${views.length} tasks`}>
          {views.length}
        </span>
        {onToggleCollapsed ? (
          <button
            type="button"
            className="btn btn-icon column-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            title={expanded ? 'Collapse column' : 'Expand column'}
            onClick={onToggleCollapsed}
          >
            <span aria-hidden="true">{expanded ? '‹' : '›'}</span>
          </button>
        ) : null}
      </header>
      {colHint && !colHint.ok && colHint.reason ? (
        <div className="column-hint" role="status">
          {colHint.reason}
        </div>
      ) : null}
      {expanded ? (
        <div className="column-body">
          {body}
          {views.length > limit ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setLimit((l) => l + PAGE);
              }}
            >
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
