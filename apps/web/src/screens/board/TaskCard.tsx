import { useState } from 'react';
import { AgentHoverCard } from '../../components/AgentHoverCard.tsx';
import { Badge } from '../../components/Badge.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import type { Priority } from '../../data/types.ts';
import { CANCELLABLE, PRIORITIES, hoverInfoOf, restorable, startable } from './model.ts';
import type { BacklogApi, TaskView } from './model.ts';
import { formatClock, formatRelative } from '../../lib/schedule.ts';
import { compactCount, exactCount } from './format.ts';
import { targetKey } from './dndApi.ts';
import type { DndApi } from './dndApi.ts';

interface Props {
  view: TaskView;
  laneKey: string;
  now: number;
  selected: boolean;
  pending: boolean;
  dnd: DndApi;
  backlog: BacklogApi;
  onOpen: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: Priority) => void;
  onCancel: (taskId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

export function TaskCard({
  view,
  laneKey,
  now,
  selected,
  pending,
  dnd,
  backlog,
  onOpen,
  onSetPriority,
  onCancel,
  onOpenAgent,
}: Props) {
  const { task, run } = view;
  const isDraft = task.status === 'draft';
  const [menu, setMenu] = useState(false);
  const canRestore = restorable(task);
  const draggable = (CANCELLABLE.includes(task.status) || canRestore) && !pending;
  const target = { kind: 'card', task, laneKey } as const;
  const key = targetKey(target);
  const hint = dnd.hint?.key === key ? dnd.hint : null;
  const noEligible = task.status === 'queued' && task.noEligibleReason !== null;
  const tip = run
    ? `Input ${exactCount(run.inputTokens ?? 0)}, output ${exactCount(run.outputTokens ?? 0)}, cached ${exactCount(run.cachedTokens ?? 0)} (cached not added)`
    : 'Unknown';
  const errorText = task.error ?? run?.error ?? null;

  return (
    <article
      className={`card${selected ? ' is-selected' : ''}${dnd.draggingId === task.id ? ' is-dragging' : ''}${
        hint ? (hint.ok ? ' drop-ok' : ' drop-bad') : ''
      }`}
      data-task-id={task.id}
      aria-label={`${task.key} ${task.title}`}
      tabIndex={0}
      draggable={draggable}
      title={hint?.reason ?? undefined}
      onClick={() => {
        onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(task.id);
      }}
      onDragStart={(e) => {
        dnd.start(task, laneKey, e);
      }}
      onDragOver={(e) => {
        e.stopPropagation();
        dnd.over(key, target, e);
      }}
      onDrop={(e) => {
        e.stopPropagation();
        dnd.drop(target, e);
      }}
      onDragEnd={dnd.end}
    >
      <div className="card-top">
        {isDraft && startable(task) ? (
          <input
            type="checkbox"
            className="card-check"
            aria-label={`Select ${task.key}`}
            checked={backlog.selected.has(task.id)}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onChange={() => {
              backlog.toggle(task.id);
            }}
          />
        ) : null}
        {task.status === 'done' || task.status === 'failed' || task.status === 'denied' ? (
          canRestore ? (
            <input
              type="checkbox"
              className="card-check"
              aria-label={`Select ${task.key}`}
              checked={backlog.restoreSelected.has(task.id)}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={() => {
                backlog.toggleRestore(task.id);
              }}
            />
          ) : null
        ) : null}
        <span className="mono card-key">{task.key}</span>
        <Badge tone={task.priority === 0 ? 'crit' : 'neutral'} title={`Priority P${String(task.priority)}`}>
          {`P${String(task.priority)}`}
        </Badge>
        {pending ? <Badge tone="accent">Pending</Badge> : null}
        {task.kind === 'goal' ? <Badge tone="accent">Goal</Badge> : null}
        {errorText ? (
          <span className="card-error" role="img" aria-label={`Error: ${errorText}`} title={errorText}>
            ⚠
          </span>
        ) : null}
        <span className="card-spacer" />
        <div className="card-menu">
          <button
            type="button"
            className="btn btn-icon"
            aria-label={`Actions for ${task.key}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
          >
            ⋯
          </button>
          {menu ? (
            <div
              className="menu"
              role="menu"
              onClick={(e) => {
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setMenu(false);
                }
              }}
            >
              {isDraft && startable(task) ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    backlog.start(task.id);
                  }}
                >
                  Start
                </button>
              ) : null}
              {isDraft ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      backlog.edit(task.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      backlog.remove(task.id);
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : null}
              {task.status === 'queued'
                ? PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="menuitem"
                      disabled={p === task.priority}
                      onClick={() => {
                        setMenu(false);
                        onSetPriority(task.id, p);
                      }}
                    >
                      {`Set priority P${String(p)}`}
                    </button>
                  ))
                : null}
              {canRestore ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    backlog.rerun([task.id]);
                  }}
                >
                  Run again
                </button>
              ) : null}
              {task.kind !== 'goal' && task.parentTaskId === null ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    backlog.duplicate(task.id);
                  }}
                >
                  Duplicate
                </button>
              ) : null}
              {canRestore ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    backlog.toBacklog([task.id]);
                  }}
                >
                  Move to backlog
                </button>
              ) : null}
              {CANCELLABLE.includes(task.status) ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onCancel(task.id);
                  }}
                >
                  Cancel
                </button>
              ) : isDraft || canRestore ? null : (
                <span className="menu-empty dim">No actions available</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <h3 className="card-title" title={task.title}>
        {task.title}
      </h3>
      <div className="card-status">
        <StatusDot kind="task" value={task.status} />
        {noEligible ? (
          <span title={task.noEligibleReason ?? undefined}>
            <StatusDot kind="indicator" value="no_eligible_agent" />
          </span>
        ) : null}
      </div>
      {noEligible ? <div className="card-reason dim">{task.noEligibleReason}</div> : null}
      {view.proposedBy ? (
        <div className="card-reason">
          <Badge tone="accent">{`Proposed by ${view.proposedBy}`}</Badge>
          {task.parentTaskId ? (
            <button
              type="button"
              className="btn btn-link"
              onClick={(e) => {
                e.stopPropagation();
                backlog.review(task.parentTaskId ?? '');
              }}
            >
              Review plan
            </button>
          ) : null}
        </div>
      ) : null}
      {view.goal?.status === 'awaiting_approval' ? (
        <div className="card-reason">
          <Badge tone="warn">Plan awaiting approval</Badge>
        </div>
      ) : null}
      {task.status === 'scheduled' && task.startAfterReset && task.runAt ? (
        <div className="card-reason dim">
          <time dateTime={task.runAt} title={new Date(task.runAt).toLocaleString()}>
            {`starts after limit reset at ${formatClock(task.runAt)}`}
          </time>
        </div>
      ) : null}
      {task.status === 'scheduled' && task.runAt && !task.startAfterReset ? (
        <div className="card-reason dim">
          <time dateTime={task.runAt} title={new Date(task.runAt).toLocaleString()}>
            {`Runs ${formatRelative(task.runAt, now)}`}
          </time>
        </div>
      ) : null}
      {task.status === 'rate_limited' ? (
        <div className="card-reason dim">
          {task.resumeAt
            ? `Resumes at ${formatClock(task.resumeAt)} (attempt ${String(task.attempt)}/${String(task.maxAttempts)})`
            : run?.rateLimitResetsAt
              ? `Resets ${new Date(run.rateLimitResetsAt).toLocaleString()}`
              : 'Reset time unknown'}
        </div>
      ) : null}
      <div className="card-assignee">
        {view.agent ? (
          <AgentHoverCard agent={hoverInfoOf(view.agent, view.agentAccount)} onOpen={onOpenAgent}>
            <span>{view.assignee}</span>
          </AgentHoverCard>
        ) : (
          <span>{view.assignee}</span>
        )}
      </div>
      {view.labels.length > 0 ? (
        <ul className="chips" aria-label="Labels">
          {view.labels.map((l) => (
            <li key={`${l.tip}:${l.text}`} className="chip" title={l.tip}>
              {l.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="card-foot dim">
        <span>{view.elapsed(now)}</span>
        <span title={tip}>
          {view.tokens === null ? 'Unknown tokens' : `${compactCount(view.tokens)} tokens`}
        </span>
      </div>
    </article>
  );
}
