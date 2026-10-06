import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface DockSpec {
  title: string;
  body: ReactNode;
}

export interface Workspace {
  /** Element that hosts the details panel (portal target). */
  detailsHost: HTMLElement | null;
  dock: DockSpec | null;
  openDock: (spec: DockSpec) => void;
  closeDock: () => void;
  setItemCount: (count: number | null) => void;
}

export const WorkspaceContext = createContext<Workspace>({
  detailsHost: null,
  dock: null,
  openDock: () => undefined,
  closeDock: () => undefined,
  setItemCount: () => undefined,
});

export function useWorkspace(): Workspace {
  return useContext(WorkspaceContext);
}

export function useItemCount(count: number | null) {
  const { setItemCount } = useWorkspace();
  useEffect(() => {
    setItemCount(count);
    return () => {
      setItemCount(null);
    };
  }, [count, setItemCount]);
}
