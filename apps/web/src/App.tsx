import { useMemo } from 'react';
import { createApi } from './api/client.ts';
import type { Api } from './api/client.ts';
import { ApiProvider } from './api/context.tsx';
import { createEventsClient, createStaticEvents } from './api/events.ts';
import type { EventsClient } from './api/events.ts';
import { DataSourceProvider } from './data/context.tsx';
import { createLiveDataSource } from './data/live.ts';
import { createMockDataSource } from './data/mock.ts';
import type { BoardDataSource } from './data/source.ts';
import { Shell } from './layout/Shell.tsx';
import type { RouteId } from './router/routes.ts';
import { AccountsScreen } from './screens/accounts/AccountsScreen.tsx';
import { AgentsScreen } from './screens/agents/AgentsScreen.tsx';
import { AuditScreen } from './screens/audit/AuditScreen.tsx';
import { BoardScreen } from './screens/board/BoardScreen.tsx';
import { DashboardScreen } from './screens/dashboard/DashboardScreen.tsx';
import { GroupsScreen } from './screens/groups/GroupsScreen.tsx';
import { PeopleScreen } from './screens/people/PeopleScreen.tsx';
import { PoliciesScreen } from './screens/policies/PoliciesScreen.tsx';
import { RunsScreen } from './screens/runs/RunsScreen.tsx';
import { SkillsScreen } from './screens/skills/SkillsScreen.tsx';
import { TasksScreen } from './screens/tasks/TasksScreen.tsx';

interface Props {
  dataSource?: BoardDataSource;
  api?: Api;
  events?: EventsClient;
  /** Forces mock data; defaults to `?mock=1` in the URL. */
  mock?: boolean;
}

function screenFor(route: RouteId) {
  switch (route) {
    case 'board':
      return <BoardScreen />;
    case 'dashboard':
      return <DashboardScreen />;
    case 'agents':
      return <AgentsScreen />;
    case 'agent-groups':
      return <GroupsScreen />;
    case 'tasks':
      return <TasksScreen />;
    case 'runs':
      return <RunsScreen />;
    case 'skills':
      return <SkillsScreen />;
    case 'policies':
      return <PoliciesScreen />;
    case 'accounts':
      return <AccountsScreen />;
    case 'people':
      return <PeopleScreen />;
    case 'audit':
      return <AuditScreen />;
  }
}

export function App({ dataSource, api, events, mock }: Props) {
  const useMock =
    mock ?? (dataSource ? true : new URLSearchParams(window.location.search).get('mock') === '1');
  const resolvedApi = useMemo(() => api ?? createApi(), [api]);
  const resolvedEvents = useMemo(
    () => events ?? (useMock ? createStaticEvents() : createEventsClient()),
    [events, useMock],
  );
  const source = useMemo(
    () =>
      dataSource ?? (useMock ? createMockDataSource() : createLiveDataSource(resolvedApi, resolvedEvents)),
    [dataSource, useMock, resolvedApi, resolvedEvents],
  );
  return (
    <ApiProvider api={resolvedApi} events={resolvedEvents}>
      <DataSourceProvider source={source}>
        <Shell>{screenFor}</Shell>
      </DataSourceProvider>
    </ApiProvider>
  );
}
