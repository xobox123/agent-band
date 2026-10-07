import { useState } from 'react';
import type { StartWhen } from '@agent-band/contracts';
import { errorMessage } from '../api/client.ts';
import { useEscape } from '../hooks/useEscape.ts';
import { localToIso } from '../lib/schedule.ts';

interface Props {
  title: string;
  /** What is being started, e.g. "3 tasks". */
  subject: string;
  confirmLabel?: string;
  onConfirm: (when: StartWhen) => Promise<void>;
  onCancel: () => void;
}

type Choice = 'now' | 'at' | 'limit_reset';

/** Asks when started tasks may begin: now, at a time, or when the account limit window resets. */
export function StartDialog({ title, subject, confirmLabel = 'Start', onConfirm, onCancel }: Props) {
  const [choice, setChoice] = useState<Choice>('now');
  const [at, setAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEscape(3, true, onCancel);

  const iso = localToIso(at);
  let invalid: string | null = null;
  if (choice === 'at') {
    if (!iso) invalid = 'Pick a start time.';
    else if (Date.parse(iso) <= Date.now()) invalid = 'The start time must be in the future.';
  }

  const submit = () => {
    if (invalid || pending) return;
    const when: StartWhen =
      choice === 'now'
        ? { mode: 'now' }
        : choice === 'at' && iso
          ? { mode: 'at', at: iso }
          : { mode: 'limit_reset' };
    setPending(true);
    setError(null);
    onConfirm(when).catch((e: unknown) => {
      setError(e);
      setPending(false);
    });
  };

  const option = (value: Choice, label: string, help?: string) => (
    <label className="radio-row">
      <input
        type="radio"
        name="start-when"
        value={value}
        checked={choice === value}
        onChange={() => {
          setChoice(value);
        }}
      />
      <span>
        {label}
        {help ? <span className="form-help dim">{help}</span> : null}
      </span>
    </label>
  );

  return (
    <div className="overlay">
      <div className="dialog dialog-form" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog-title">{title}</h2>
        <p className="dim">{`Start ${subject}:`}</p>
        <div className="radio-group" role="radiogroup" aria-label="When to start">
          {option('now', 'Start now')}
          {option('at', 'Start at a chosen time')}
          {choice === 'at' ? (
            <input
              className="field"
              type="datetime-local"
              aria-label="Start time"
              value={at}
              onChange={(e) => {
                setAt(e.target.value);
              }}
            />
          ) : null}
          {option(
            'limit_reset',
            "Start when the account's limit window resets",
            'Uses the latest usage snapshot of the target agent account. Without one, it starts now.',
          )}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {errorMessage(error)}
          </p>
        ) : null}
        {invalid ? <p className="form-hint dim">{invalid}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || Boolean(invalid)}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
