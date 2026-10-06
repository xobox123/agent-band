import type { TaskDto } from '@agent-band/contracts';
import { useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { FilterInput } from '../../components/FilterInput.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime } from '../../lib/format.ts';

function targetText(t: TaskDto['target']): string {
  if ('agentId' in t) return `Agent ${t.agentId.slice(0, 8)}`;
  if ('label' in t) return `Label: ${t.label}`;
  return `Group ${t.agentGroupId.slice(0, 8)}`;
}

export function TasksScreen() {
  const api = useApi();
  const state = useResource(() => api.tasks.list(), [], ['task.']);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const text = search.trim().toLowerCase();
  const all = state.data?.items ?? [];
  const rows = all.filter((t) => text === '' || `${t.key} ${t.title}`.toLowerCase().includes(text));
  useItemCount(state.data ? rows.length : null);
  const task = all.find((t) => t.id === selected);

  const columns: Column<TaskDto>[] = [
    { id: 'key', header: 'Key', sortValue: (t) => t.key, cell: (t) => <span className="mono">{t.key}</span> },
    { id: 'title', header: 'Title', sortValue: (t) => t.title, cell: (t) => t.title },
    {
      id: 'status',
      header: 'Status',
      sortValue: (t) => t.status,
      cell: (t) => <StatusDot kind="task" value={t.status} />,
    },
    { id: 'target', header: 'Target', cell: (t) => targetText(t.target) },
    {
      id: 'priority',
      header: 'Priority',
      sortValue: (t) => t.priority,
      cell: (t) => `P${String(t.priority)}`,
    },
    {
      id: 'workDir',
      header: 'Work directory',
      sortValue: (t) => t.workDir,
      cell: (t) => (
        <span className="mono" title={t.workDir}>
          {t.workDir}
        </span>
      ),
    },
    { id: 'created', header: 'Created', sortValue: (t) => t.createdAt, cell: (t) => formatTime(t.createdAt) },
  ];

  return (
    <div className="screen">
      <Toolbar label="Tasks toolbar">
        <FilterInput
          label="Search tasks"
          placeholder="Search key or title (/)"
          value={search}
          onChange={setSearch}
        />
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load tasks. Retry.">
          {() =>
            all.length === 0 ? (
              <EmptyState title="No tasks yet. Create your first task." />
            ) : rows.length === 0 ? (
              <EmptyState title="No matches. Clear filters to see all items." />
            ) : (
              <Table
                label="Tasks"
                columns={columns}
                rows={rows}
                getRowId={(t) => t.id}
                selectedId={selected}
                onSelect={(t) => {
                  setSelected(t.id);
                }}
                defaultSort={{ columnId: 'created', direction: 'desc' }}
              />
            )
          }
        </Resource>
      </div>
      {task ? (
        <DetailsPanel
          title={task.title}
          subtitle={task.key}
          onClose={() => {
            setSelected(null);
          }}
        >
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <StatusDot kind="task" value={task.status} />
            </dd>
            <dt>Target</dt>
            <dd>{targetText(task.target)}</dd>
            <dt>Mode</dt>
            <dd>{task.mode ?? 'Effective cap'}</dd>
            <dt>Work directory</dt>
            <dd className="mono-wrap">{task.workDir}</dd>
            <dt>Updated</dt>
            <dd>{formatTime(task.updatedAt)}</dd>
          </dl>
          {task.error ? <p>{task.error}</p> : null}
          <h3 className="section-title">Prompt</h3>
          <pre className="prompt">{task.prompt}</pre>
        </DetailsPanel>
      ) : null}
    </div>
  );
}
