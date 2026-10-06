import { useEffect, useRef } from 'react';
import type { SyntheticEvent, ReactNode } from 'react';
import { errorMessage } from '../api/client.ts';
import { useEscape } from '../hooks/useEscape.ts';

interface Props {
  title: string;
  submitLabel: string;
  pending: boolean;
  error?: unknown;
  /** Returns false to block submit (inline validation message shown via `invalid`). */
  invalid?: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}

export function FormDialog({
  title,
  submitLabel,
  pending,
  error,
  invalid,
  onSubmit,
  onCancel,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(3, true, onCancel);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!pending && !invalid) onSubmit();
  };

  return (
    <div className="overlay">
      <div className="dialog dialog-form" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="dialog-title">{title}</h2>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">{children}</div>
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
            <button type="submit" className="btn btn-primary" disabled={pending || Boolean(invalid)}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  help?: string;
  children: ReactNode;
}

export function Field({ label, help, children }: FieldProps) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
      {help ? <span className="form-help dim">{help}</span> : null}
    </label>
  );
}
