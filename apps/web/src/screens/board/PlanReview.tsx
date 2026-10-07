import { useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { DictationTextarea } from '../../components/DictationButton.tsx';
import type { TaskView } from './model.ts';

interface Props {
  leader: string;
  round: number;
  items: TaskView[];
  titleOf: (taskId: string) => string;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onAdd: () => void;
  onEdit: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}

/** The leader's proposed plan: review, adjust, then approve or ask for changes. */
export function PlanReview({
  leader,
  round,
  items,
  titleOf,
  busy,
  error,
  onApprove,
  onRequestChanges,
  onAdd,
  onEdit,
  onRemove,
}: Props) {
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState('');

  return (
    <section aria-label="Plan review" className="plan-review">
      <h3 className="section-title">
        Plan review <Badge tone="warn">Awaiting approval</Badge>
      </h3>
      <p className="dim">{`${leader} proposed ${String(items.length)} subtask${items.length === 1 ? '' : 's'} (round ${String(round)}). Nothing runs until you approve.`}</p>
      {items.length === 0 ? (
        <p className="dim">The plan is empty. Add a subtask or request changes.</p>
      ) : null}
      <ol className="plan-list">
        {items.map((v) => (
          <li key={v.task.id} className="plan-item">
            <div className="plan-item-head">
              <span className="mono dim">{v.task.key}</span>
              <strong>{v.task.title}</strong>
              <span className="card-spacer" />
              <button
                type="button"
                className="btn"
                aria-label={`Edit ${v.task.key}`}
                onClick={() => {
                  onEdit(v.task.id);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Remove ${v.task.key}`}
                onClick={() => {
                  onRemove(v.task.id);
                }}
              >
                Remove
              </button>
            </div>
            <div className="dim">{`Assignee: ${v.assignee}`}</div>
            {v.task.dependsOn.length > 0 ? (
              <div className="dim">{`Depends on: ${v.task.dependsOn.map(titleOf).join(', ')}`}</div>
            ) : null}
            <details>
              <summary>Prompt</summary>
              <pre className="prompt">{v.task.prompt}</pre>
            </details>
          </li>
        ))}
      </ol>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {asking ? (
        <div className="plan-feedback">
          <label className="form-field">
            <span className="form-label">What should change?</span>
            <DictationTextarea
              className="field"
              rows={4}
              aria-label="Feedback for the leader"
              value={feedback}
              onChange={(e) => {
                setFeedback(e.target.value);
              }}
            />
          </label>
          <div className="plan-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAsking(false);
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || feedback.trim() === ''}
              onClick={() => {
                onRequestChanges(feedback.trim());
              }}
            >
              Send feedback
            </button>
          </div>
        </div>
      ) : (
        <div className="plan-actions">
          <button type="button" className="btn" onClick={onAdd}>
            Add subtask
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAsking(true);
            }}
          >
            Request changes
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || items.length === 0}
            onClick={onApprove}
          >
            Approve plan
          </button>
        </div>
      )}
    </section>
  );
}
