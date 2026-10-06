import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { BoardDataSource } from './source.ts';

const DataSourceContext = createContext<BoardDataSource | null>(null);

export function DataSourceProvider({ source, children }: { source: BoardDataSource; children: ReactNode }) {
  return <DataSourceContext.Provider value={source}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): BoardDataSource {
  const source = useContext(DataSourceContext);
  if (!source) throw new Error('DataSourceProvider is missing');
  return source;
}
