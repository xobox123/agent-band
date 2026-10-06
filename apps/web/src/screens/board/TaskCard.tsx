import { useState } from 'react';
import { Avatar } from '../../components/Avatar.tsx';
import { Badge } from '../../components/Badge.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import type { Priority } from '../../data/types.ts';
import { CANCELLABLE, PRIORITIES } from './model.ts';
import type { TaskView } from './model.ts';
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
  onOpen: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: Priority) => void;
  onCancel: (taskId: string) => void;
}

export function TaskCard({
  view,
  laneKey,
  now,
  selected,
  pending,
  dnd,
  onOpen,
  onSetPriority,
  onCancel,
}: Props) {
  const { task, run } = view;
  const [menu, setMenu] = useState(false);
  const draggable = CANCELLABLE.includes(task.status) && !pending;
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
        <span className="mono card-key">{task.key}</span>
        <Badge tone={task.priority === 0 ? 'crit' : 'neutral'} title={`Priority P${String(task.priority)}`}>
          {`P${String(task.priority)}`}
        </Badge>
        {pending ? <Badge tone="accent">Pending</Badge> : null}
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
              ) : (
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
      {task.status === 'rate_limited' ? (
        <div className="card-reason dim">
          {run?.rateLimitResetsAt
            ? `Resets ${new Date(run.rateLimitResetsAt).toLocaleString()}`
            : 'Reset time unknown'}
        </div>
      ) : null}
      <div className="card-assignee">
        {view.agent ? <Avatar name={view.agent.name} avatar={view.agent.avatar} /> : null}
        <span>{view.assignee}</span>
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
