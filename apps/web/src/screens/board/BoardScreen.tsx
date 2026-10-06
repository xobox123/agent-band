import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorState } from '../../components/ErrorState.tsx';
import { FilterInput } from '../../components/FilterInput.tsx';
import { FilterSelect } from '../../components/FilterSelect.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useDataSource } from '../../data/context.tsx';
import type { BoardFilter, Priority, Task } from '../../data/types.ts';
import { useEscape } from '../../hooks/useEscape.ts';
import { useNow } from '../../hooks/useNow.ts';
import { useItemCount, useWorkspace } from '../../layout/WorkspaceContext.tsx';
import { BoardColumns } from './BoardColumns.tsx';
import { BoardList } from './BoardList.tsx';
import { TaskDetails } from './TaskDetails.tsx';
import { evaluateDrop } from './dnd.ts';
import type { DropTarget } from './dnd.ts';
import type { DndApi, DndHint } from './dndApi.ts';
import { buildLookup, viewOf } from './model.ts';
import type { TaskView } from './model.ts';
import { useBoard } from './useBoard.ts';

const AGENT_HELP =
  'Matches assigned agents and explicit targets; unresolved label and group targets have no account.';

export function BoardScreen() {
  const source = useDataSource();
  const { openDock } = useWorkspace();
  const now = useNow();

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [swimlanes, setSwimlanes] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(text.trim());
    }, 250);
    return () => {
      clearTimeout(id);
    };
  }, [text]);

  const filter: BoardFilter = useMemo(
    () => ({ text: debounced, agentId, label, accountId }),
    [debounced, agentId, label, accountId],
  );
  const filtered = filter.text !== '' || agentId !== null || label !== null || accountId !== null;

  const { snapshot, loading, error, refreshFailedAt, reload } = useBoard(source, filter);
  useItemCount(snapshot?.tasks.length ?? null);

  const views = useMemo(() => {
    if (!snapshot) return [];
    const lookup = buildLookup(snapshot);
    return snapshot.tasks.map((t) => viewOf(t, lookup));
  }, [snapshot]);

  const known = useRef(new Map<string, TaskView>());
  for (const v of views) known.current.set(v.task.id, v);

  const selectedView = selectedId
    ? (views.find((v) => v.task.id === selectedId) ?? known.current.get(selectedId))
    : undefined;
  const outsideView = selectedView !== undefined && !views.some((v) => v.task.id === selectedView.task.id);

  const labelOptions = useMemo(() => {
    const set = new Set<string>();
    snapshot?.agents.forEach((a) => {
      a.labels.forEach((l) => set.add(l));
    });
    snapshot?.tasks.forEach((t) => {
      if (t.target.type === 'label') set.add(t.target.label);
    });
    return [...set].sort().map((l) => ({ value: l, label: l }));
  }, [snapshot]);

  const clearFilters = () => {
    setText('');
    setDebounced('');
    setAgentId(null);
    setLabel(null);
    setAccountId(null);
  };

  const mutate = useCallback(
    async (taskId: string, run: () => Promise<void>) => {
      setNotice(null);
      setPendingIds((prev) => new Set(prev).add(taskId));
      try {
        await run();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'The change was rejected.');
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
        reload();
      }
    },
    [reload],
  );

  const onSetPriority = useCallback(
    (taskId: string, priority: Priority) => {
      void mutate(taskId, () => source.setPriority(taskId, priority));
    },
    [mutate, source],
  );
  const onCancel = useCallback((taskId: string) => {
    setConfirmId(taskId);
  }, []);
  const confirmView = confirmId ? known.current.get(confirmId) : undefined;

  // Drag and drop
  const dragRef = useRef<{ task: Task; laneKey: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hint, setHint] = useState<DndHint | null>(null);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDraggingId(null);
    setHint(null);
  }, []);
  useEscape(4, draggingId !== null, endDrag);

  useEffect(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = views.find((v) => v.task.id === drag.task.id);
    if (current?.task.status !== drag.task.status) {
      endDrag();
      setNotice('Task state changed while you were dragging. Review the updated card.');
    }
  }, [views, endDrag]);

  const dnd: DndApi = useMemo(
    () => ({
      draggingId,
      hint,
      start: (task: Task, laneKey: string, event: DragEvent) => {
        dragRef.current = { task, laneKey };
        setDraggingId(task.id);
        setNotice(null);
        const transfer = event.dataTransfer as DataTransfer | null;
        if (transfer) {
          transfer.effectAllowed = 'move';
          transfer.setData('text/plain', task.key);
        }
      },
      over: (key: string, target: DropTarget, event: DragEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        event.preventDefault();
        const result = evaluateDrop(drag.task, drag.laneKey, target);
        const ok = result.kind === 'reorder' || result.kind === 'cancel';
        const transfer = event.dataTransfer as DataTransfer | null;
        if (transfer) transfer.dropEffect = ok ? 'move' : 'none';
        const reason = result.kind === 'reject' ? result.reason : null;
        setHint((prev) =>
          prev?.key === key && prev.ok === ok && prev.reason === reason ? prev : { key, ok, reason },
        );
      },
      drop: (target: DropTarget, event: DragEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        event.preventDefault();
        const result = evaluateDrop(drag.task, drag.laneKey, target);
        endDrag();
        if (result.kind === 'reject') setNotice(result.reason);
        else if (result.kind === 'cancel') setConfirmId(drag.task.id);
        else if (result.kind === 'reorder') {
          const { beforeId } = result;
          void mutate(drag.task.id, () => source.reorder(drag.task.id, beforeId));
        }
      },
      end: endDrag,
    }),
    [draggingId, hint, endDrag, mutate, source],
  );

  const openLogs = (v: TaskView) => {
    if (!v.run) return;
    openDock({
      title: `Run log: ${v.task.key}`,
      body: (
        <p className="dim">
          {`Run ${v.run.id} (${v.run.status}). Log streaming is not available on mock data.`}
        </p>
      ),
    });
  };

  let content;
  if (error) {
    content = <ErrorState message="Could not load the board. Retry." onRetry={reload} />;
  } else if (!snapshot) {
    content = (
      <div className="skeleton" aria-busy="true" aria-label="Loading board">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  } else if (views.length === 0 && !loading) {
    content = filtered ? (
      <EmptyState
        title="No matches. Clear filters to see all items."
        action={
          <button type="button" className="btn" onClick={clearFilters}>
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState title="No tasks yet. Create your first task." />
    );
  } else if (view === 'list') {
    content = <BoardList views={views} now={now} selectedId={selectedId} onOpen={setSelectedId} />;
  } else {
    content = (
      <BoardColumns
        views={views}
        swimlanes={swimlanes}
        now={now}
        selectedId={selectedId}
        pendingIds={pendingIds}
        dnd={dnd}
        onOpen={setSelectedId}
        onSetPriority={onSetPriority}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div className="board">
      <Toolbar label="Board toolbar">
        <button type="button" className="btn btn-primary" disabled title="Task creation is not available yet">
          New task
        </button>
        <FilterInput
          label="Search tasks"
          placeholder="Search key or title (/)"
          value={text}
          onChange={setText}
        />
        <FilterSelect
          label="Agent"
          title={AGENT_HELP}
          value={agentId}
          onChange={setAgentId}
          options={(snapshot?.agents ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <FilterSelect label="Label" value={label} onChange={setLabel} options={labelOptions} />
        <FilterSelect
          label="Account"
          title={AGENT_HELP}
          value={accountId}
          onChange={setAccountId}
          options={(snapshot?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <label className="inline-field">
          Swimlanes
          <select
            className="field"
            aria-label="Swimlanes"
            value={swimlanes ? 'agent' : 'none'}
            onChange={(e) => {
              setSwimlanes(e.target.value === 'agent');
            }}
          >
            <option value="none">None</option>
            <option value="agent">Agent</option>
          </select>
        </label>
        <span className="segmented" role="group" aria-label="View">
          <button
            type="button"
            className="btn"
            aria-pressed={view === 'cards'}
            onClick={() => {
              setView('cards');
            }}
          >
            Cards
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={view === 'list'}
            onClick={() => {
              setView('list');
            }}
          >
            List
          </button>
        </span>
        <button type="button" className="btn" onClick={reload}>
          Refresh
        </button>
        <button type="button" className="btn" disabled={!filtered} onClick={clearFilters}>
          Clear filters
        </button>
      </Toolbar>
      {refreshFailedAt ? (
        <div className="banner banner-warn" role="status">
          {`Showing saved data. Refresh failed. ${refreshFailedAt.toLocaleTimeString()}`}
        </div>
      ) : null}
      {notice ? (
        <div className="banner banner-crit" role="alert">
          <span>{notice}</span>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Dismiss message"
            onClick={() => {
              setNotice(null);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className="board-content">{content}</div>
      {selectedView ? (
        <TaskDetails
          view={selectedView}
          now={now}
          outsideView={outsideView}
          onClose={() => {
            setSelectedId(null);
          }}
          onCancel={onCancel}
          onSetPriority={onSetPriority}
          onOpenLogs={openLogs}
        />
      ) : null}
      {confirmView ? (
        <ConfirmDialog
          title={`Cancel ${confirmView.task.key}?`}
          message={`Cancel ${confirmView.task.key}? Work already performed will remain in its run history.`}
          confirmLabel="Cancel task"
          onCancel={() => {
            setConfirmId(null);
          }}
          onConfirm={() => {
            const id = confirmView.task.id;
            setConfirmId(null);
            void mutate(id, () => source.cancel(id));
          }}
        />
      ) : null}
    </div>
  );
}
