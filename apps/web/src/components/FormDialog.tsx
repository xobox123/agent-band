import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactElement, SyntheticEvent, ReactNode } from 'react';
import { errorMessage, fieldErrors } from '../api/client.ts';
import { useEscape } from '../hooks/useEscape.ts';

/** Per-field error messages of the open form, keyed by Field `name`. */
const ErrorsContext = createContext<Record<string, string>>({});

interface Props {
  title: string;
  submitLabel: string;
  pending: boolean;
  error?: unknown;
  /** Returns false to block submit (inline validation message shown via `invalid`). */
  invalid?: string | null;
  /** Inline errors by field name; the first invalid field is focused after each submit. */
  errors?: Record<string, string>;
  /** Maps server validation details onto these field names (path to name). */
  fieldAlias?: (path: string) => string;
  onSubmit: () => void;
  onCancel: () => void;
  /** Optional second submit button next to the primary one. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  children: ReactNode;
}

export function FormDialog({
  title,
  submitLabel,
  pending,
  error,
  invalid,
  errors,
  fieldAlias,
  onSubmit,
  onCancel,
  secondaryLabel,
  onSecondary,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(3, true, onCancel);
  const [submits, setSubmits] = useState(0);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [missing, setMissing] = useState<string[]>([]);
  const server = error ? fieldErrors(error, fieldAlias) : {};
  const all = errors ?? {};
  const allKey = JSON.stringify(all);
  const shown = Object.fromEntries(Object.entries(all).filter(([k]) => submits > 0 || touched.has(k)));
  const merged = { ...server, ...shown };
  const blocked = Object.keys(all).length > 0;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    setMissing(
      Object.keys(all).map(
        (k) => root.querySelector<HTMLElement>(`[data-field="${k}"]`)?.dataset['label'] ?? k,
      ),
    );
  }, [allKey]);

  const focusFirst = () => {
    const first = Object.keys(all)[0];
    ref.current
      ?.querySelector<HTMLElement>(`[data-field="${first ?? ''}"] :is(input, select, textarea)`)
      ?.focus();
  };
  const unmapped = error && Object.keys(server).length === 0;
  const mergedKey = JSON.stringify(merged);

  useEffect(() => {
    if (submits === 0) return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [submits, mergedKey]);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSubmits((n) => n + 1);
    if (!pending && !invalid) onSubmit();
  };

  return (
    <div className="overlay">
      <div className="dialog dialog-form" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="dialog-title">{title}</h2>
        <form
          onSubmit={submit}
          noValidate
          onBlurCapture={(e) => {
            const name = (e.target as HTMLElement).closest<HTMLElement>('[data-field]')?.dataset['field'];
            if (name) setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
          }}
        >
          <ErrorsContext.Provider value={merged}>
            <div className="form-grid">{children}</div>
          </ErrorsContext.Provider>
          {unmapped ? (
            <p className="form-error" role="alert">
              {errorMessage(error)}
            </p>
          ) : null}
          {invalid ? <p className="form-hint dim">{invalid}</p> : null}
          {blocked && !pending ? (
            <p className="form-hint dim">
              <button type="button" className="btn-link missing-hint" onClick={focusFirst}>
                {`Missing: ${missing.join(', ')}`}
              </button>
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            {secondaryLabel && onSecondary ? (
              <button
                type="button"
                className="btn"
                disabled={pending || Boolean(invalid) || blocked}
                onClick={() => {
                  if (!pending && !invalid && !blocked) onSecondary();
                }}
              >
                {secondaryLabel}
              </button>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pending || Boolean(invalid) || blocked}
            >
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
  /** Key of this field in the form's `errors`. */
  name?: string;
  /** Marks the field as required (asterisk, aria-required). */
  required?: boolean;
  help?: string;
  children: ReactNode;
}

export function Field({ label, name, required, help, children }: FieldProps) {
  const errors = useContext(ErrorsContext);
  const message = name ? errors[name] : undefined;
  const id = name ? `err-${name}` : undefined;
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : undefined;
  const control =
    isValidElement(only) && (message || required)
      ? cloneElement(only as ReactElement<Record<string, unknown>>, {
          ...(required ? { 'aria-required': true } : {}),
          ...(message
            ? {
                'aria-invalid': true,
                'aria-describedby': id,
                className: `${(only.props as { className?: string }).className ?? ''} is-invalid`.trim(),
              }
            : {}),
        })
      : children;
  return (
    <label className="form-field" data-field={name} data-label={label}>
      <span className="form-label">
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
      </span>
      {control}
      {message ? (
        <span className="field-error" id={id} role="alert">
          {message}
        </span>
      ) : help ? (
        <span className="form-help dim">{help}</span>
      ) : null}
    </label>
  );
}
