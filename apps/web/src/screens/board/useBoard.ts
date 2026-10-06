import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardDataSource } from '../../data/source.ts';
import type { BoardFilter, BoardSnapshot } from '../../data/types.ts';

export interface BoardState {
  snapshot: BoardSnapshot | null;
  loading: boolean;
  /** Initial load failed. */
  error: boolean;
  /** Last refresh failed while data is shown. */
  refreshFailedAt: Date | null;
  reload: () => void;
}

export function useBoard(source: BoardDataSource, filter: BoardFilter): BoardState {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshFailedAt, setRefreshFailedAt] = useState<Date | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const seq = useRef(0);
  const hasData = useRef(false);

  const reload = useCallback(() => {
    const id = ++seq.current;
    source.load(filterRef.current).then(
      (next) => {
        if (id !== seq.current) return;
        hasData.current = true;
        setSnapshot(next);
        setError(false);
        setRefreshFailedAt(null);
        setLoading(false);
      },
      () => {
        if (id !== seq.current) return;
        if (hasData.current) setRefreshFailedAt(new Date());
        else setError(true);
        setLoading(false);
      },
    );
  }, [source]);

  const { text, agentId, label, accountId } = filter;
  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload, text, agentId, label, accountId]);

  useEffect(() => source.subscribe(reload), [source, reload]);

  return { snapshot, loading, error, refreshFailedAt, reload };
}
