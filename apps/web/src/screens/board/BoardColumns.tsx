import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Priority } from '../../data/types.ts';
import { BoardColumn } from './BoardColumn.tsx';
import { COLUMNS, laneOf, sortQueued, sortRecent } from './model.ts';
import type { BacklogApi, TaskView } from './model.ts';
import type { DndApi } from './dndApi.ts';

interface Props {
  views: TaskView[];
  swimlanes: boolean;
  now: number;
  selectedId: string | null;
  pendingIds: Set<string>;
  dnd: DndApi;
  backlog: BacklogApi;
  onOpen: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: Priority) => void;
  onCancel: (taskId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

export const NO_LANE = '__all';

export function BoardColumns({ views, swimlanes, ...rest }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    const box = el.getBoundingClientRect();
    const next = new Set<string>();
    el.querySelectorAll<HTMLElement>('[data-column]').forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1))
        next.add(node.dataset.column ?? '');
    });
    setHidden((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
  }, []);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  });

  const reveal = (id: string) => {
    if (id === 'cancelled') setCancelledOpen(true);
    if (id === 'scheduled') setScheduledOpen(true);
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-column="${id}"]`);
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  const counts = useMemo(
    () =>
      COLUMNS.map((c) => ({
        column: c,
        count: views.filter((v) => c.statuses.includes(v.task.status)).length,
      })),
    [views],
  );

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
          column.id === 'queued' || column.id === 'draft'
            ? sortQueued(inColumn.map((v) => v.task))
            : sortRecent(inColumn.map((v) => v.task));
        const byId = new Map(inColumn.map((v) => [v.task.id, v]));
        const ordered = sorted.flatMap((t) => byId.get(t.id) ?? []);
        const isCancelled = column.id === 'cancelled';
        const emptyScheduled = column.id === 'scheduled' && ordered.length === 0;
        const toggle = (set: (fn: (v: boolean) => boolean) => void) => () => {
          set((v) => !v);
        };
        return (
          <BoardColumn
            key={column.id}
            column={column}
            views={ordered}
            laneKey={laneKey}
            collapsed={(isCancelled && !cancelledOpen) || (emptyScheduled && !scheduledOpen)}
            onToggleCollapsed={
              isCancelled ? toggle(setCancelledOpen) : emptyScheduled ? toggle(setScheduledOpen) : undefined
            }
            {...rest}
          />
        );
      })}
    </div>
  );

  const strip = (
    <nav className="column-strip" aria-label="Board columns">
      {counts.map(({ column, count }) => (
        <button
          key={column.id}
          type="button"
          className={`column-chip${hidden.has(column.id) ? ' is-hidden' : ''}`}
          title={hidden.has(column.id) ? `Show ${column.title} (off screen)` : `Go to ${column.title}`}
          onClick={() => {
            reveal(column.id);
          }}
        >
          {column.title}
          <span className="count">{count}</span>
        </button>
      ))}
    </nav>
  );

  const frame = (children: ReactNode) => (
    <div className="board-frame">
      {strip}
      <div
        className={`board-scroll-wrap${edges.left ? ' fade-left' : ''}${edges.right ? ' fade-right' : ''}`}
      >
        <div ref={scrollRef} className="board-scroll" onScroll={measure}>
          {children}
        </div>
      </div>
    </div>
  );

  if (!swimlanes) return frame(renderColumns(NO_LANE, views));

  return frame(
    <>
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
    </>,
  );
}
