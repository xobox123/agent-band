import type { ScheduleDto, TaskDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
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
import { describeCron } from '../../lib/schedule.ts';
import { ScheduleForm, agentsFor, groupsFor } from './ScheduleForm.tsx';

function describeTarget(target: ScheduleDto['template']['target']): string {
  if ('agentId' in target) return `Agent ${target.agentId}`;
  if ('label' in target) return `Label: ${target.label}`;
  return `Group ${target.agentGroupId}`;
}

export function SchedulesScreen() {
  const api = useApi();
  const state = useResource(
    async () => {
      const [schedules, org, agents, groups] = await Promise.all([
        api.schedules.list(),
        api.organization(),
        api.agents.list(),
        api.groups.list(),
      ]);
      const history = new Map<string, TaskDto[]>();
      await Promise.all(
        schedules.items.map(async (s) => {
          const tasks = await api.schedules.tasks(s.id).catch(() => ({ items: [] as TaskDto[] }));
          history.set(
            s.id,
            [...tasks.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          );
        }),
      );
      return {
        schedules: schedules.items,
        history,
        orgTimezone: org.timezone,
        agents: agentsFor(agents.items),
        groups: groupsFor(groups.items),
      };
    },
    [],
    ['schedule.', 'task.'],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ key: string; id: string } | null>(null);
  const mutation = useMutation();

  const rows = state.data?.schedules ?? [];
  useItemCount(state.data ? rows.length : null);
  const schedule = rows.find((s) => s.id === selected);
  const orgTimezone = state.data?.orgTimezone ?? '';

  const lastTask = (s: ScheduleDto): TaskDto | undefined => {
    const tasks = state.data?.history.get(s.id) ?? [];
    return tasks.find((t) => t.id === s.lastTaskId) ?? tasks[0];
  };

  const toggle = (s: ScheduleDto) => {
    void mutation
      .ok(() => api.schedules.update(s.id, { enabled: !s.enabled }))
      .then((ok) => {
        if (ok) state.reload();
      });
  };

  const columns: Column<ScheduleDto>[] = [
    { id: 'name', header: 'Name', sortValue: (s) => s.name, cell: (s) => s.name },
    {
      id: 'cron',
      header: 'Schedule',
      sortValue: (s) => s.cron,
      cell: (s) => (
        <span title={s.cron}>
          {describeCron(s.cron)}
          {describeCron(s.cron) === s.cron ? '' : <span className="mono dim">{`  ${s.cron}`}</span>}
        </span>
      ),
    },
    {
      id: 'next',
      header: 'Next fire',
      sortValue: (s) => (s.enabled ? s.nextFireAt : '9999'),
      cell: (s) => (s.enabled ? formatTime(s.nextFireAt) : <span className="dim">Paused</span>),
    },
    {
      id: 'last',
      header: 'Last fire',
      sortValue: (s) => s.lastFiredAt ?? '',
      cell: (s) => (s.lastFiredAt ? formatTime(s.lastFiredAt) : <span className="dim">Never</span>),
    },
    {
      id: 'status',
      header: 'Last task',
      cell: (s) => {
        const task = lastTask(s);
        return task ? <StatusDot kind="task" value={task.status} /> : <span className="dim">None</span>;
      },
    },
    {
      id: 'enabled',
      header: 'Enabled',
      width: 90,
      cell: (s) => (
        <input
          type="checkbox"
          role="switch"
          aria-label={`Enabled ${s.name}`}
          checked={s.enabled}
          disabled={mutation.pending}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onChange={() => {
            toggle(s);
          }}
        />
      ),
    },
  ];

  const afterSave = (saved?: ScheduleDto) => {
    if (saved) {
      setForm(null);
      setSelected(saved.id);
      state.reload();
    }
  };

  const history = schedule ? (state.data?.history.get(schedule.id) ?? []) : [];

  return (
    <div className="screen">
      <Toolbar label="Schedules toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('create');
          }}
        >
          Create schedule
        </button>
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load schedules. Retry.">
          {() =>
            rows.length === 0 ? (
              <EmptyState title="No schedules yet. Create a schedule." />
            ) : (
              <Table
                label="Schedules"
                columns={columns}
                rows={rows}
                getRowId={(s) => s.id}
                selectedId={selected}
                onSelect={(s) => {
                  setNotice(null);
                  setSelected(s.id);
                }}
                defaultSort={{ columnId: 'name', direction: 'asc' }}
              />
            )
          }
        </Resource>
      </div>
      {schedule ? (
        <DetailsPanel
          title={schedule.name}
          subtitle={schedule.id}
          onClose={() => {
            setSelected(null);
          }}
          banner={
            notice ? (
              <span>
                {'Created '}
                <a href={`#/board?task=${notice.id}`}>{notice.key}</a>
              </span>
            ) : undefined
          }
          footer={
            <>
              <button
                type="button"
                className="btn"
                disabled={mutation.pending}
                onClick={() => {
                  setNotice(null);
                  void mutation
                    .run(() => api.schedules.runNow(schedule.id))
                    .then((task) => {
                      if (task) {
                        setNotice({ key: task.key, id: task.id });
                        state.reload();
                      }
                    });
                }}
              >
                Run now
              </button>
              <button
                type="button"
                className="btn"
                disabled={mutation.pending}
                onClick={() => {
                  toggle(schedule);
                }}
              >
                {schedule.enabled ? 'Disable' : 'Enable'}
              </button>
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
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  mutation.clearError();
                  setConfirmDelete(true);
                }}
              >
                Delete
              </button>
              {mutation.error && !form && !confirmDelete ? (
                <span className="form-error">{errorMessage(mutation.error)}</span>
              ) : null}
            </>
          }
        >
          <dl className="kv">
            <dt>Status</dt>
            <dd>{schedule.enabled ? 'Enabled' : 'Disabled'}</dd>
            <dt>Cron</dt>
            <dd>
              {describeCron(schedule.cron)} <span className="mono dim">{schedule.cron}</span>
            </dd>
            <dt>Time zone</dt>
            <dd>{schedule.timezone ?? `Organization (${orgTimezone})`}</dd>
            <dt>Next fire</dt>
            <dd>{schedule.enabled ? formatTime(schedule.nextFireAt) : 'Paused'}</dd>
            <dt>Last fire</dt>
            <dd>{schedule.lastFiredAt ? formatTime(schedule.lastFiredAt) : 'Never'}</dd>
            <dt>Overlap</dt>
            <dd>{schedule.overlap === 'skip' ? 'Skip the new run' : 'Queue the new run'}</dd>
            <dt>Template</dt>
            <dd>
              <div>{schedule.template.title}</div>
              <div className="mono dim">{schedule.template.workDir}</div>
              <div className="dim">
                {`${describeTarget(schedule.template.target)}, P${String(schedule.template.priority)}${
                  schedule.template.mode ? `, ${schedule.template.mode}` : ''
                }`}
              </div>
              <pre className="prompt">{schedule.template.prompt}</pre>
            </dd>
          </dl>
          <section>
            <h3 className="section-title">Task history</h3>
            {history.length === 0 ? (
              <p className="dim">No tasks yet.</p>
            ) : (
              <ul className="history-list">
                {history.slice(0, 20).map((t) => (
                  <li key={t.id}>
                    <a href={`#/board?task=${t.id}`}>
                      <span className="mono">{t.key}</span> {t.title}
                    </a>
                    <StatusDot kind="task" value={t.status} />
                    <time className="dim" dateTime={t.createdAt}>
                      {formatTime(t.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </DetailsPanel>
      ) : null}
      {form && state.data ? (
        <ScheduleForm
          schedule={form === 'edit' ? schedule : undefined}
          agents={state.data.agents}
          groups={state.data.groups}
          orgTimezone={state.data.orgTimezone}
          pending={mutation.pending}
          error={mutation.error}
          onCreate={(body) => {
            void mutation.run(() => api.schedules.create(body)).then(afterSave);
          }}
          onUpdate={(id, body) => {
            void mutation.run(() => api.schedules.update(id, body)).then(afterSave);
          }}
          onCancel={() => {
            setForm(null);
          }}
        />
      ) : null}
      {confirmDelete && schedule ? (
        <ConfirmDialog
          title={`Delete ${schedule.name}?`}
          message={`Delete ${schedule.name}? Tasks it already created are kept.`}
          confirmLabel="Delete schedule"
          cancelLabel="Keep schedule"
          busy={mutation.pending}
          error={mutation.error ? errorMessage(mutation.error) : undefined}
          onCancel={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            void mutation
              .ok(() => api.schedules.remove(schedule.id))
              .then((ok) => {
                if (ok) {
                  setConfirmDelete(false);
                  setSelected(null);
                  state.reload();
                }
              });
          }}
        />
      ) : null}
    </div>
  );
}
