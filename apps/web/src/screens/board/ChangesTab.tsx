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
  const [override, setOverride] = useState('');
  const review = task.review;
  const open = task.status === 'done' && (review?.status === 'pending' || review?.status === 'conflict');
  const badges = reviewBadges(task);
  const gate = state.data?.gate ?? null;
  const overriding = gate !== null && !gate.canMerge && gate.overridable;
  const reason = override.trim();
  const mergeBlocked = gate !== null && !gate.canMerge && !(overriding && reason !== '');

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
                  {`Merge conflict in ${(data.review.conflictFiles ?? []).join(', ') || 'some files'}. The branch ${task.branch ?? ''} is kept. A new commit needs new checks and a new review before it can be merged.`}
                </p>
              ) : null}
              {data.gate ? (
                <section>
                  <h3 className="section-title">Merge gate</h3>
                  <ul className="check-list">
                    <li>
                      <Badge tone={data.gate.checks === 'passed' ? 'ok' : 'crit'}>
                        {data.gate.checks === 'passed'
                          ? 'Checks passed'
                          : data.gate.checks === 'failed'
                            ? 'Checks failed'
                            : 'Checks outdated'}
                      </Badge>{' '}
                      <span className="dim">on this commit</span>
                    </li>
                    <li>
                      <Badge tone={data.gate.verdict === 'approved' ? 'ok' : 'warn'}>
                        {data.gate.verdict === 'approved'
                          ? 'Reviewer approved'
                          : data.gate.verdict === 'changes_requested'
                            ? 'Reviewer requested changes'
                            : data.gate.verdict === 'stale'
                              ? 'Verdict is for another commit'
                              : 'Not reviewed yet'}
                      </Badge>{' '}
                      <span className="mono dim">{data.gate.sha.slice(0, 7)}</span>
                    </li>
                    {data.gate.liveSha === data.gate.sha ? null : (
                      <li>
                        <Badge tone="crit">Branch moved</Badge>{' '}
                        <span className="mono dim">{(data.gate.liveSha ?? 'unknown').slice(0, 7)}</span>
                      </li>
                    )}
                  </ul>
                  {data.gate.blockers.map((b) => (
                    <p key={b.code} className="dim">
                      {b.message}
                    </p>
                  ))}
                  {data.gate.canMerge ? <p className="dim">Ready to merge.</p> : null}
                </section>
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
                  {(data.review.reviewerFindings ?? []).length > 0 ? (
                    <ul className="check-list">
                      {(data.review.reviewerFindings ?? []).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  ) : data.reviewer.summary ? (
                    <pre className="prompt">{data.reviewer.summary}</pre>
                  ) : null}
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
      {open && overriding ? (
        <label className="form-field">
          <span className="form-label">Override reason (merges without an approving reviewer verdict)</span>
          <input
            className="field"
            value={override}
            maxLength={1000}
            onChange={(e) => {
              setOverride(e.target.value);
            }}
          />
        </label>
      ) : null}
      {open ? (
        <div className="changes-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={mutation.pending || mergeBlocked}
            onClick={() => {
              void mutation
                .ok(() => api.tasks.approveReview(task.id, overriding ? reason : undefined))
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
