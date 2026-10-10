import type { PolicyDto, ProjectDto, TaskDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime } from '../../lib/format.ts';
import { ProjectForm } from './ProjectForm.tsx';

const OPEN = ['draft', 'scheduled', 'queued', 'claimed', 'running', 'rate_limited'];

export function ProjectsScreen() {
  const api = useApi();
  const state = useResource(
    async () => {
      const [projects, policies] = await Promise.all([api.projects.list(), api.policies.list()]);
      const tasks = new Map<string, TaskDto[]>();
      await Promise.all(
        projects.items.map(async (p) => {
          const page = await api.tasks.list({ projectId: p.id }).catch(() => ({ items: [] as TaskDto[] }));
          tasks.set(
            p.id,
            [...page.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
          );
        }),
      );
      return { projects: projects.items, policies: policies.items, tasks };
    },
    [],
    ['project.', 'task.'],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);
  const [policyId, setPolicyId] = useState('');
  const [allowed, setAllowed] = useState<string | null>(null);
  const mutation = useMutation();

  const rows = state.data?.projects ?? [];
  useItemCount(state.data ? rows.length : null);
  const project = rows.find((p) => p.id === selected);
  const policies: PolicyDto[] = state.data?.policies ?? [];
  const tasksOf = (p: ProjectDto): TaskDto[] => state.data?.tasks.get(p.id) ?? [];

  const columns: Column<ProjectDto>[] = [
    { id: 'name', header: 'Name', sortValue: (p) => p.name, cell: (p) => p.name },
    {
      id: 'repo',
      header: 'Repository',
      sortValue: (p) => p.repoPath,
      cell: (p) => <span className="mono">{p.repoPath}</span>,
    },
    {
      id: 'branch',
      header: 'Default branch',
      sortValue: (p) => p.defaultBranch,
      cell: (p) => <span className="mono">{p.defaultBranch}</span>,
    },
    {
      id: 'checks',
      header: 'Checks',
      width: 90,
      sortValue: (p) => p.checks.length,
      cell: (p) => String(p.checks.length),
    },
    {
      id: 'open',
      header: 'Open tasks',
      width: 110,
      sortValue: (p) => tasksOf(p).filter((t) => OPEN.includes(t.status)).length,
      cell: (p) => String(tasksOf(p).filter((t) => OPEN.includes(t.status)).length),
    },
  ];

  const afterSave = (saved?: ProjectDto) => {
    if (saved) {
      setForm(null);
      setSelected(saved.id);
      state.reload();
    }
  };

  const open = project ? tasksOf(project).filter((t) => OPEN.includes(t.status)) : [];
  const awaiting = project
    ? tasksOf(project).filter((t) => t.review && t.review.status !== 'merged' && !OPEN.includes(t.status))
    : [];
  const merged = project
    ? tasksOf(project)
        .filter((t) => t.review?.status === 'merged')
        .slice(0, 10)
    : [];

  return (
    <div className="screen">
      <Toolbar label="Projects toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('create');
          }}
        >
          Create project
        </button>
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load projects. Retry.">
          {() =>
            rows.length === 0 ? (
              <EmptyState
                title="No projects yet. Create a project."
                description="A project points at a git repository; every task in it works in its own worktree and branch."
              />
            ) : (
              <Table
                label="Projects"
                columns={columns}
                rows={rows}
                getRowId={(p) => p.id}
                selectedId={selected}
                onSelect={(p) => {
                  setAllowed(null);
                  mutation.clearError();
                  setSelected(p.id);
                }}
                defaultSort={{ columnId: 'name', direction: 'asc' }}
              />
            )
          }
        </Resource>
      </div>
      {project ? (
        <DetailsPanel
          title={project.name}
          subtitle={project.slug}
          onClose={() => {
            setSelected(null);
          }}
          footer={
            <button
              type="button"
              className="btn"
              onClick={() => {
                mutation.clearError();
                setForm('edit');
              }}
            >
              Edit
            </button>
          }
        >
          <dl className="kv">
            <dt>Repository</dt>
            <dd className="mono">{project.repoPath}</dd>
            <dt>Default branch</dt>
            <dd className="mono">{project.defaultBranch}</dd>
            <dt>Worktrees</dt>
            <dd className="mono">{project.worktreesRoot}</dd>
            <dt>Checks</dt>
            <dd>
              {project.checks.length === 0 ? (
                <span className="dim">None</span>
              ) : (
                project.checks.map((c) => (
                  <div key={c} className="mono">
                    {c}
                  </div>
                ))
              )}
            </dd>
            <dt>After merge</dt>
            <dd>{project.keepWorktrees ? 'Keep worktrees and branches' : 'Remove worktree and branch'}</dd>
          </dl>
          <section>
            <h3 className="section-title">Agent access</h3>
            <p className="dim">
              Agents may only work in directories their policy allows. Add the worktrees folder to a policy.
            </p>
            <div className="inline-field">
              <select
                className="field"
                aria-label="Policy"
                value={policyId}
                onChange={(e) => {
                  setAllowed(null);
                  setPolicyId(e.target.value);
                }}
              >
                <option value="">Select a policy</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={policyId === '' || mutation.pending}
                onClick={() => {
                  void mutation
                    .run(() => api.projects.allowAgents(project.id, policyId))
                    .then((result) => {
                      if (result)
                        setAllowed(
                          result.added
                            ? 'Added to the policy.'
                            : 'The policy already allows this folder or does not restrict directories.',
                        );
                    });
                }}
              >
                Allow agents to work in this project
              </button>
            </div>
            {allowed ? <p role="status">{allowed}</p> : null}
            {mutation.error && !form ? <p className="form-error">{errorMessage(mutation.error)}</p> : null}
          </section>
          <TaskList title="Open tasks" empty="No open tasks." tasks={open} />
          <TaskList title="Awaiting review" empty="Nothing awaiting review." tasks={awaiting} />
          <TaskList title="Recent merges" empty="Nothing merged yet." tasks={merged} />
        </DetailsPanel>
      ) : null}
      {form ? (
        <ProjectForm
          project={form === 'edit' ? project : undefined}
          pending={mutation.pending}
          error={mutation.error}
          onCreate={(body) => {
            void mutation.run(() => api.projects.create(body)).then(afterSave);
          }}
          onUpdate={(id, body) => {
            void mutation.run(() => api.projects.update(id, body)).then(afterSave);
          }}
          onCancel={() => {
            setForm(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TaskList({ title, empty, tasks }: { title: string; empty: string; tasks: TaskDto[] }) {
  return (
    <section>
      <h3 className="section-title">{title}</h3>
      {tasks.length === 0 ? (
        <p className="dim">{empty}</p>
      ) : (
        <ul className="history-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <a href={`#/board?task=${t.id}`}>
                <span className="mono">{t.key}</span> {t.title}
              </a>
              <StatusDot kind="task" value={t.status} />
              <time className="dim" dateTime={t.updatedAt}>
                {formatTime(t.updatedAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
