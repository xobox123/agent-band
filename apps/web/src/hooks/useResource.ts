import { useCallback, useEffect, useRef, useState } from 'react';
import { useServerEvents } from '../api/context.tsx';

export interface Resource<T> {
  data: T | null;
  /** The first load failed. */
  error: unknown;
  loading: boolean;
  /** A later refresh failed while data is shown. */
  refreshFailedAt: Date | null;
  reload: () => void;
}

/** Loads on mount and when `deps` change; reloads on matching server events. */
export function useResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  events: string[] = [],
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshFailedAt, setRefreshFailedAt] = useState<Date | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const hasData = useRef(false);

  const reload = useCallback(() => {
    const id = ++seq.current;
    loadRef.current().then(
      (next) => {
        if (id !== seq.current) return;
        hasData.current = true;
        setData(next);
        setError(null);
        setRefreshFailedAt(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (id !== seq.current) return;
        if (hasData.current) setRefreshFailedAt(new Date());
        else setError(e);
        setLoading(false);
      },
    );
  }, []);

  const depKey = JSON.stringify(deps);
  useEffect(() => {
    hasData.current = false;
    setData(null);
    setError(null);
    setLoading(true);
    reload();
  }, [reload, depKey]);

  useServerEvents(events, reload);
  useEffect(
    () => () => {
      seq.current += 1;
    },
    [],
  );

  return { data, error, loading, refreshFailedAt, reload };
}

export function useMutation() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  /** Runs `fn` and reports whether it succeeded. */
  const ok = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  return {
    pending,
    error,
    run,
    ok,
    clearError: () => {
      setError(null);
    },
  };
}
