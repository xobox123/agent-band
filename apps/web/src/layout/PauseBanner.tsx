import { useState } from 'react';
import { errorMessage } from '../api/client.ts';
import { useApi } from '../api/context.tsx';
import { useResource } from '../hooks/useResource.ts';

/** Global strip: the organization is paused (no new runs start) or can be paused. */
export function PauseBanner() {
  const api = useApi();
  const org = useResource(() => api.organization(), [], ['org.']);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = org.data?.paused === true;

  const toggle = (next: boolean) => {
    setPending(true);
    setError(null);
    api.setOrgPaused(next).then(
      () => {
        setPending(false);
        org.reload();
      },
      (e: unknown) => {
        setPending(false);
        setError(errorMessage(e));
      },
    );
  };

  if (!org.data) return null;
  return (
    <>
      {paused ? (
        <div className="banner banner-warn pause-banner" role="status">
          <span>
            <strong>Paused.</strong> No new tasks start. Runs already in progress continue.
          </span>
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => {
              toggle(false);
            }}
          >
            Resume
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="banner banner-crit" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

/** Header control that pauses the whole organization. */
export function PauseButton() {
  const api = useApi();
  const org = useResource(() => api.organization(), [], ['org.']);
  const [pending, setPending] = useState(false);
  if (!org.data || org.data.paused) return null;
  return (
    <button
      type="button"
      className="btn"
      disabled={pending}
      title="Stop starting new tasks; running runs continue"
      onClick={() => {
        setPending(true);
        api.setOrgPaused(true).then(
          () => {
            setPending(false);
            org.reload();
          },
          () => {
            setPending(false);
          },
        );
      }}
    >
      Pause all
    </button>
  );
}
