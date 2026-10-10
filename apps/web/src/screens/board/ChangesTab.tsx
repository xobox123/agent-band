import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { Badge } from '../../components/Badge.tsx';
import { Resource } from '../../components/Resource.tsx';
import type { Task } from '../../data/types.ts';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { splitDiff } from '../../lib/diff.ts';
import { reviewBadges } from './model.ts';

const sign = (n: number, c: '+' | '-') => `${c}${String(n)}`;

function DiffLines({ text }: { text: string }) {
  return (
    <pre className="diff-text mono">
      {text.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-del'
                : undefined
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

/** Review of a project task: what changed, how the checks went, and the decision buttons. */
export function ChangesTab({ task }: { task: Task }) {
  const api = useApi();
  const state = useResource(() => api.tasks.diff(task.id), [task.id, task.updatedAt], ['task.']);
  const mutation = useMutation();
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const review = task.review;
  const open = task.status === 'done' && (review?.status === 'pending' || review?.status === 'conflict');
  const badges = reviewBadges(task);

  return (
    <div className="changes">
      <Resource state={state} errorMessage="Could not load the changes. Retry.">
        {(data) => {
          const files = splitDiff(data.diff);
          const textOf = new Map(files.map((f) => [f.path, f.text]));
          return (
            <>
              <div>
                {badges.map((b) => (
                  <Badge key={b.text} tone={b.tone} {...(b.title ? { title: b.title } : {})}>
                    {b.text}
                  </Badge>
                ))}{' '}
                <span>
                  {`${String(data.review.diffStat.files)} files, `}
                  <span className="diff-add">{sign(data.review.diffStat.additions, '+')}</span>{' '}
                  <span className="diff-del">{sign(data.review.diffStat.deletions, '-')}</span>
                </span>{' '}
                <span className="mono dim" title="base..head">
                  {`${data.baseSha.slice(0, 7)}..${data.headSha.slice(0, 7)}`}
                </span>
              </div>
              {data.review.status === 'conflict' ? (
                <p className="form-error" role="alert">
                  {`Merge conflict in ${(data.review.conflictFiles ?? []).join(', ') || 'some files'}. The branch ${task.branch ?? ''} is kept; resolve it in the worktree and approve again.`}
                </p>
              ) : null}
              {data.review.mergeError ? <p className="form-error">{data.review.mergeError}</p> : null}
              {data.review.feedback && data.review.status === 'rejected' ? (
                <p>
                  <strong>Feedback: </strong>
                  {data.review.feedback}
                </p>
              ) : null}
              <section>
                <h3 className="section-title">Checks</h3>
                {data.review.checks.length === 0 ? (
                  <p className="dim">This project has no checks.</p>
                ) : (
                  <ul className="check-list">
                    {data.review.checks.map((c) => (
                      <li key={c.command}>
                        <details>
                          <summary>
                            <Badge tone={c.exitCode === 0 ? 'ok' : 'crit'}>
                              {c.exitCode === 0 ? 'passed' : `exit ${String(c.exitCode)}`}
                            </Badge>{' '}
                            <span className="mono">{c.command}</span>{' '}
                            <span className="dim">{`${String(Math.round(c.durationMs / 100) / 10)} s`}</span>
                          </summary>
                          <pre className="diff-text mono">{c.output ?? ''}</pre>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="section-title">Commits</h3>
                <ul className="check-list">
                  {data.review.commits.map((c) => (
                    <li key={c.sha}>
                      <span className="mono dim">{c.sha.slice(0, 7)}</span> {c.subject}
                    </li>
                  ))}
                </ul>
              </section>
              {data.reviewer ? (
                <section>
                  <h3 className="section-title">Reviewer</h3>
                  <p className="dim">{`Reviewer task is ${data.reviewer.status}.`}</p>
                  {data.reviewer.summary ? <pre className="prompt">{data.reviewer.summary}</pre> : null}
                </section>
              ) : null}
              <section>
                <h3 className="section-title">Files</h3>
                {data.files.length === 0 ? (
                  <p className="dim">No file changes.</p>
                ) : (
                  <ul className="file-list">
                    {data.files.map((f) => (
                      <li key={f.path}>
                        <details className="file-diff">
                          <summary>
                            <span className="mono">{f.path}</span>
                            <span className="diff-add">{sign(f.additions, '+')}</span>
                            <span className="diff-del">{sign(f.deletions, '-')}</span>
                          </summary>
                          <DiffLines
                            text={textOf.get(f.path) ?? 'No diff available (binary or too large).'}
                          />
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
                {data.truncated ? (
                  <p className="dim">The diff is too large and was cut. Open the branch to see the rest.</p>
                ) : null}
              </section>
            </>
          );
        }}
      </Resource>
      {mutation.error ? (
        <p className="form-error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {open ? (
        <div className="changes-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={mutation.pending}
            onClick={() => {
              void mutation
                .ok(() => api.tasks.approveReview(task.id))
                .then((ok) => {
                  if (ok) state.reload();
                });
            }}
          >
            Approve and merge
          </button>
          <button
            type="button"
            className="btn"
            disabled={mutation.pending}
            onClick={() => {
              mutation.clearError();
              setAsking((a) => !a);
            }}
          >
            Request changes
          </button>
          <button
            type="button"
            className="btn"
            disabled={mutation.pending}
            onClick={() => {
              void mutation
                .ok(() => api.tasks.requestReview(task.id))
                .then((ok) => {
                  if (ok) state.reload();
                });
            }}
          >
            Ask reviewer
          </button>
        </div>
      ) : null}
      {open && asking ? (
        <form
          className="changes"
          onSubmit={(e) => {
            e.preventDefault();
            if (feedback.trim() === '') return;
            void mutation
              .ok(() => api.tasks.rejectReview(task.id, feedback.trim()))
              .then((ok) => {
                if (ok) {
                  setAsking(false);
                  setFeedback('');
                }
              });
          }}
        >
          <label className="form-field">
            <span className="form-label">Feedback for the agent</span>
            <textarea
              className="field"
              rows={4}
              value={feedback}
              onChange={(e) => {
                setFeedback(e.target.value);
              }}
            />
          </label>
          <div className="changes-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.pending || feedback.trim() === ''}
            >
              Send feedback and requeue
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The Changes tab is shown once an agent finished and the task has a review. */
export const hasChanges = (task: Task): boolean => task.review !== null && task.review !== undefined;
