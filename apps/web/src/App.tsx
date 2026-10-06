import { useMemo } from 'react';
import { DataSourceProvider } from './data/context.tsx';
import { createMockDataSource } from './data/mock.ts';
import type { BoardDataSource } from './data/source.ts';
import { Shell } from './layout/Shell.tsx';
import { routeLabel } from './router/routes.ts';
import { BoardScreen } from './screens/board/BoardScreen.tsx';
import { Placeholder } from './screens/Placeholder.tsx';

export function App({ dataSource }: { dataSource?: BoardDataSource }) {
  const source = useMemo(() => dataSource ?? createMockDataSource(), [dataSource]);
  return (
    <DataSourceProvider source={source}>
      <Shell>
        {(route) => (route === 'board' ? <BoardScreen /> : <Placeholder name={routeLabel(route)} />)}
      </Shell>
    </DataSourceProvider>
  );
}
