import { useEffect, useRef, useState } from 'react';
import { errorMessage, fieldErrors } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { Resource } from '../../components/Resource.tsx';
import { useResource } from '../../hooks/useResource.ts';

const WORKER_SLOTS_HELP = [
  'Leave blank to derive the global limit from account concurrency (maximum 256).',
  'Changes take effect without restarting the worker.',
  'If automatic, an environment override takes precedence.',
].join(' ');

export function SettingsScreen() {
  const api = useApi();
  const state = useResource(() => api.organization(), [], ['org.']);
  const [root, setRoot] = useState('');
  const [workerSlots, setWorkerSlots] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const rootRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.data) {
      setRoot(state.data.workspaceRoot);
      setWorkerSlots(state.data.workerSlots == null ? '' : String(state.data.workerSlots));
    }
  }, [state.data]);

  const clientError =
    !root.startsWith('/') || root.split('/').includes('..')
      ? 'Workspace root must be an absolute path without .. segments.'
      : undefined;
  const slots = workerSlots.trim() === '' ? null : Number(workerSlots);
  const slotsError =
    slots !== null && (!Number.isInteger(slots) || slots < 1 || slots > 256)
      ? 'Use an integer from 1 to 256, or leave blank for automatic.'
      : undefined;
  const server = fieldErrors(error);
  const rootError = (touched || submitted ? clientError : undefined) ?? server['workspaceRoot'];
  const generic = error && server['workspaceRoot'] === undefined ? errorMessage(error) : null;
  const save = () => {
    setPending(true);
    setError(null);
    setSaved(false);
    const savedSlots = state.data?.workerSlots ?? null;
    const base = { workspaceRoot: root };
    const payload = slots === savedSlots ? base : { ...base, workerSlots: slots };
    api.updateOrganization(payload).then(
      () => {
        setPending(false);
        setSaved(true);
        state.reload();
      },
      (e: unknown) => {
        setPending(false);
        setError(e);
      },
    );
  };

  return (
    <div className="screen">
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load settings. Retry.">
          {(org) => (
            <form
              className="settings"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
                if (clientError) rootRef.current?.focus();
                else if (!pending && !slotsError) save();
              }}
            >
              <h2 className="section-title">{org.name}</h2>
              <details className="advanced" open>
                <summary>Advanced</summary>
                <label className="form-field">
                  <span className="form-label">
                    Workspace root{' '}
                    <span className="req" aria-hidden="true">
                      *
                    </span>
                  </span>
                  <input
                    ref={rootRef}
                    className={`field mono${rootError ? ' is-invalid' : ''}`}
                    aria-label="Workspace root"
                    aria-required
                    aria-invalid={rootError ? true : undefined}
                    aria-describedby={rootError ? 'err-workspaceRoot' : undefined}
                    value={root}
                    onBlur={() => {
                      setTouched(true);
                    }}
                    onChange={(e) => {
                      setRoot(e.target.value);
                      setSaved(false);
                    }}
                  />
                  {rootError ? (
                    <span className="field-error" id="err-workspaceRoot" role="alert">
                      {rootError}
                    </span>
                  ) : null}
                  <span className="form-help dim">
                    Tasks without a project folder get their own folder here, named after the task key. The
                    default organization policy allows this folder; a folder outside it needs a policy that
                    allows it.
                  </span>
                </label>
              </details>
              <label className="form-field">
                <span className="form-label">Worker slots (optional)</span>
                <input
                  className="field"
                  aria-label="Worker slots"
                  type="number"
                  min={1}
                  max={256}
                  step={1}
                  value={workerSlots}
                  onChange={(e) => {
                    setWorkerSlots(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="Automatic"
                />
                <span className="form-help dim">{WORKER_SLOTS_HELP}</span>
                {slotsError ? (
                  <span className="field-error" role="alert">
                    {slotsError}
                  </span>
                ) : null}
              </label>
              {generic ? (
                <p className="form-error" role="alert">
                  {generic}
                </p>
              ) : null}
              {saved ? <p className="dim">Saved.</p> : null}
              <div className="dialog-actions">
                {clientError ? (
                  <button
                    type="button"
                    className="btn-link missing-hint"
                    onClick={() => {
                      rootRef.current?.focus();
                    }}
                  >
                    Missing: Workspace root
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pending || Boolean(clientError) || Boolean(slotsError)}
                >
                  Save
                </button>
              </div>
            </form>
          )}
        </Resource>
      </div>
    </div>
  );
}
