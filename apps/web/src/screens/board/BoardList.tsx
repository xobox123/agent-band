import { AgentHoverCard } from '../../components/AgentHoverCard.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { compactCount, exactCount } from './format.ts';
import { hoverInfoOf } from './model.ts';
import type { TaskView } from './model.ts';

interface Props {
  views: TaskView[];
  now: number;
  selectedId: string | null;
  onOpen: (taskId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

export function BoardList({ views, now, selectedId, onOpen, onOpenAgent }: Props) {
  const columns: Column<TaskView>[] = [
    {
      id: 'key',
      header: 'Key',
      width: 90,
      sortValue: (v) => v.task.key,
      cell: (v) => <span className="mono">{v.task.key}</span>,
    },
    { id: 'title', header: 'Title', sortValue: (v) => v.task.title, cell: (v) => v.task.title },
    {
      id: 'status',
      header: 'Status',
      width: 130,
      sortValue: (v) => v.task.status,
      cell: (v) => <StatusDot kind="task" value={v.task.status} />,
    },
    {
      id: 'assignee',
      header: 'Assignee / target',
      cell: (v) => (
        <span className="card-assignee">
          {v.agent ? (
            <AgentHoverCard agent={hoverInfoOf(v.agent, v.agentAccount)} onOpen={onOpenAgent} size={18}>
              <span>{v.assignee}</span>
            </AgentHoverCard>
          ) : (
            v.assignee
          )}
        </span>
      ),
    },
    { id: 'account', header: 'Account', cell: (v) => v.account?.name ?? 'Unassigned' },
    {
      id: 'labels',
      header: 'Labels',
      cell: (v) => (
        <span className="chips">
          {v.labels.map((l) => (
            <span key={`${l.tip}:${l.text}`} className="chip" title={l.tip}>
              {l.text}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: 'priority',
      header: 'Priority',
      width: 80,
      sortValue: (v) => v.task.priority,
      cell: (v) => `P${String(v.task.priority)}`,
    },
    { id: 'elapsed', header: 'Elapsed', width: 90, cell: (v) => v.elapsed(now) },
    {
      id: 'tokens',
      header: 'Tokens',
      width: 90,
      cell: (v) => (
        <span title={v.run ? `Cached ${exactCount(v.run.cachedTokens ?? 0)}` : undefined}>
          {v.tokens === null ? 'Unknown' : compactCount(v.tokens)}
        </span>
      ),
    },
    {
      id: 'updated',
      header: 'Updated',
      width: 170,
      sortValue: (v) => v.task.updatedAt,
      cell: (v) => new Date(v.task.updatedAt).toLocaleString(),
    },
  ];

  return (
    <Table
      label="Tasks"
      columns={columns}
      rows={views}
      getRowId={(v) => v.task.id}
      selectedId={selectedId}
      onSelect={(v) => {
        onOpen(v.task.id);
      }}
      defaultSort={{ columnId: 'priority', direction: 'asc' }}
    />
  );
}
