import type { ReactNode } from 'react';
import type { Resource as ResourceState } from '../hooks/useResource.ts';
import { ErrorState } from './ErrorState.tsx';

interface Props<T> {
  state: ResourceState<T>;
  errorMessage: string;
  children: (data: T) => ReactNode;
}

/** Skeleton while loading, screen-specific error with Retry, saved-data banner on failed refresh. */
export function Resource<T>({ state, errorMessage, children }: Props<T>) {
  if (state.data === null) {
    if (state.error) return <ErrorState message={errorMessage} onRetry={state.reload} />;
    return (
      <div className="skeleton" aria-busy="true" aria-label="Loading">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  }
  return (
    <>
      {state.refreshFailedAt ? (
        <div className="banner banner-warn" role="status">
          {`Showing saved data. Refresh failed. ${state.refreshFailedAt.toLocaleTimeString()}`}
        </div>
      ) : null}
      {children(state.data)}
    </>
  );
}
