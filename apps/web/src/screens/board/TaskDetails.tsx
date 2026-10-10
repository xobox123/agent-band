import { useEffect, useState } from 'react';
import { useDataSource } from '../../data/context.tsx';
import type { Run } from '../../data/types.ts';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { LimitBar } from '../../components/LimitBar.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import type { Priority } from '../../data/types.ts';
import { formatClock } from '../../lib/schedule.ts';
import { exactCount } from './format.ts';
import { CANCELLABLE, PRIORITIES, restorable, startable } from './model.ts';
import type { BacklogApi, TaskView } from './model.ts';
import { PlanReview } from './PlanReview.tsx';
import { ChangesTab, hasChanges } from './ChangesTab.tsx';

interface Props {
  view: TaskView;
  now: number;
  outsideView: boolean;
  onClose: () => void;
  onCancel: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: Priority) => void;
  onOpenLogs: (view: TaskView) => void;
  backlog: BacklogApi;
  plan?: PlanProps | undefined;
}

/** Plan review wiring for a goal awaiting approval. */
export interface PlanProps {
  items: TaskView[];
  titleOf: (taskId: string) => string;
  leader: string;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onAdd: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function TaskDetails({
  view,
  now,
  outsideView,
  onClose,
  onCancel,
  onSetPriority,
  onOpenLogs,
  backlog,
  plan,
}: Props) {
  const { task, run, account } = view;
  const source = useDataSource();
  const [history, setHistory] = useState<Run[]>([]);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let active = true;
    setHistory([]);
    setHistoryError(false);
    source.taskRuns(task.id).then(
      (items) => {
        if (active) setHistory(items);
      },
      () => {
        if (active) setHistoryError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [source, task.id, task.updatedAt]);
  const [tab, setTab] = useState<'details' | 'changes'>('details');
  const showChanges = hasChanges(task);
  const copy = () => {
    void navigator.clipboard.writeText(task.id).catch(() => undefined);
  };
  const budgetPct = account?.dailyTokenBudget ? (account.tokensToday / account.dailyTokenBudget) * 100 : null;

  return (
    <DetailsPanel
      title={task.title}
      subtitle={task.key}
      onClose={onClose}
      banner={outsideView ? 'This task is outside the current view.' : undefined}
      footer={
        <>
          {task.status === 'queued' ? (
            <label className="inline-field">
              Priority
              <select
                className="field"
                aria-label="Priority"
                value={task.priority}
                onChange={(e) => {
                  onSetPriority(task.id, Number(e.target.value) as Priority);
                }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{`P${String(p)}`}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={!run}
            title={run ? undefined : 'This task has no run yet'}
            onClick={() => {
              onOpenLogs(view);
            }}
          >
            Open logs
          </button>
          {task.status === 'draft' ? (
            <>
              {startable(task) ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    backlog.start(task.id);
                  }}
                >
                  Start
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  backlog.edit(task.id);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  backlog.remove(task.id);
                }}
              >
                Delete
              </button>
            </>
          ) : null}
          {restorable(task) ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                backlog.rerun([task.id]);
              }}
            >
              Run again
            </button>
          ) : null}
          {task.kind !== 'goal' && task.parentTaskId === null ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                backlog.duplicate(task.id);
              }}
            >
              Duplicate
            </button>
          ) : null}
          {restorable(task) ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                backlog.toBacklog([task.id]);
              }}
            >
              Move to backlog
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-danger"
            disabled={!CANCELLABLE.includes(task.status)}
            onClick={() => {
              onCancel(task.id);
            }}
          >
            Cancel task
          </button>
        </>
      }
    >
      {showChanges ? (
        <div className="tabs" role="tablist" aria-label="Task sections">
          {(['details', 'changes'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
              }}
            >
              {id === 'details' ? 'Details' : 'Changes'}
            </button>
          ))}
        </div>
      ) : null}
      {showChanges && tab === 'changes' ? <ChangesTab task={task} /> : null}
      <div hidden={showChanges && tab === 'changes'}>
        <dl className="kv">
          <Row label="Status">
            <StatusDot kind="task" value={task.status} />
          </Row>
          <Row label="ID">
            <span className="mono">{task.id}</span>{' '}
            <button type="button" className="btn" onClick={copy}>
              Copy
            </button>
          </Row>
          <Row label="Priority">{`P${String(task.priority)}`}</Row>
          {task.runAt ? (
            <Row label="Run at">
              {new Date(task.runAt).toLocaleString()}
              {task.startAfterReset ? ' (after limit reset)' : ''}
            </Row>
          ) : null}
          {view.proposedBy ? <Row label="Proposed by">{view.proposedBy}</Row> : null}
          {task.resumeAt ? (
            <Row label="Resumes at">{`${formatClock(task.resumeAt)} (attempt ${String(task.attempt)}/${String(task.maxAttempts)})`}</Row>
          ) : null}
          {task.scheduleId ? (
            <Row label="Schedule">
              <a href="#/schedules">Open schedules</a>
            </Row>
          ) : null}
          <Row label="Assignee / target">{view.assignee}</Row>
          <Row label="Folder">
            <span className="mono">{task.workDir}</span>
          </Row>
          {task.branch ? (
            <Row label="Branch">
              <span className="mono">{task.branch}</span>
            </Row>
          ) : null}
          <Row label="Created by">{task.createdBy}</Row>
          <Row label="Updated">
            <time dateTime={task.updatedAt} title={task.updatedAt}>
              {new Date(task.updatedAt).toLocaleString()}
            </time>
          </Row>
          <Row label="Elapsed">{view.elapsed(now)}</Row>
          <Row label="Tokens">
            {run
              ? `Input ${exactCount(run.inputTokens ?? 0)}, output ${exactCount(run.outputTokens ?? 0)}, cached ${exactCount(run.cachedTokens ?? 0)}`
              : 'Unknown'}
          </Row>
          {account ? (
            <Row label="Account budget">
              <LimitBar
                name="Daily tokens"
                value={budgetPct}
                label={`${account.name} daily tokens`}
                title={`${exactCount(account.tokensToday)} tokens today`}
                reset="resets daily"
              />
            </Row>
          ) : null}
        </dl>
        {plan ? (
          <PlanReview
            leader={plan.leader}
            round={view.goal?.round ?? 1}
            items={plan.items}
            titleOf={plan.titleOf}
            busy={plan.busy}
            error={plan.error}
            onApprove={plan.onApprove}
            onRequestChanges={plan.onRequestChanges}
            onAdd={plan.onAdd}
            onEdit={backlog.edit}
            onRemove={backlog.remove}
          />
        ) : null}
        {task.noEligibleReason ? (
          <section>
            <h3 className="section-title">No eligible agent</h3>
            <p>{task.noEligibleReason}</p>
          </section>
        ) : null}
        {task.error ? (
          <section>
            <h3 className="section-title">Error</h3>
            <p>{task.error}</p>
          </section>
        ) : null}
        <section>
          <h3 className="section-title">Runs</h3>
          {historyError ? <p role="alert">Could not load run history.</p> : null}
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() => {
                    onOpenLogs({ ...view, run: item });
                  }}
                >
                  {item.id}
                </button>{' '}
                {item.status} {new Date(item.startedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="section-title">Prompt</h3>
          <pre className="prompt">{task.prompt}</pre>
        </section>
      </div>
    </DetailsPanel>
  );
}
