import { Badge } from '../../components/Badge.tsx';
import type { AgentDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { AgentHoverCard } from '../../components/AgentHoverCard.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { FilterInput } from '../../components/FilterInput.tsx';
import { FilterSelect } from '../../components/FilterSelect.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount, useWorkspace } from '../../layout/WorkspaceContext.tsx';
import { formatTime } from '../../lib/format.ts';
import { RunLog } from '../runs/RunLog.tsx';
import { AgentDetails } from './AgentDetails.tsx';
import { AgentForm } from './AgentForm.tsx';

export function AgentsScreen() {
  const api = useApi();
  const { openDock } = useWorkspace();
  const state = useResource(
    async () => {
      const [agents, accounts, groups, policies, runs] = await Promise.all([
        api.agents.list(),
        api.accounts.list(),
        api.groups.list(),
        api.policies.list(),
        api.runs.list({ status: 'running' }),
      ]);
      return {
        agents: agents.items,
        accounts: accounts.items,
        groups: groups.items,
        policies: policies.items,
        running: runs.items,
      };
    },
    [],
    ['agent', 'account.', 'policy.', 'run.updated'],
  );
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mutation = useMutation();

  const all = state.data?.agents ?? [];
  const text = search.trim().toLowerCase();
  const rows = all.filter(
    (a) =>
      (text === '' ||
        [a.name, a.slug, a.handle, a.persona ?? ''].some((v) => v.toLowerCase().includes(text))) &&
      (role === null || a.role === role) &&
      (enabled === null || String(a.enabled) === enabled),
  );
  useItemCount(state.data ? rows.length : null);
  const selectedAgent = all.find((a) => a.id === selected);

  const accountOf = (id: string) => state.data?.accounts.find((a) => a.id === id);
  const groupName = (id: string) => state.data?.groups.find((g) => g.id === id)?.name ?? id.slice(0, 8);
  const policyOf = (id: string | null) => {
    if (!id) return 'No agent restriction';
    const p = state.data?.policies.find((x) => x.id === id);
    return p ? `${p.name} · v${String(p.currentVersion)}` : `Deleted policy ${id.slice(0, 8)}`;
  };

  const columns: Column<AgentDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (a) => a.name,
      cell: (a) => (
        <AgentHoverCard
          agent={{
            ...a,
            avatar: a.avatar,
            status: !a.enabled
              ? 'disabled'
              : state.data?.running.some((r) => r.agentId === a.id)
                ? 'running'
                : 'idle',
            provider: accountOf(a.accountId)?.provider,
            accountName: accountOf(a.accountId)?.name,
            runningRunId: state.data?.running.find((r) => r.agentId === a.id)?.id ?? null,
          }}
          onOpen={setSelected}
        />
      ),
    },
    {
      id: 'handle',
      header: 'Handle',
      sortValue: (a) => a.handle,
      cell: (a) => <span className="mono">{a.handle}</span>,
    },
    { id: 'role', header: 'Role', sortValue: (a) => a.role, cell: (a) => a.role },
    {
      id: 'enabled',
      header: 'Enabled',
      sortValue: (a) => String(a.enabled),
      cell: (a) => (
        <>
          <StatusDot kind="agent" value={a.enabled ? 'enabled' : 'disabled'} />
          {a.paused ? <Badge tone="warn">Paused</Badge> : null}
        </>
      ),
    },
    { id: 'account', header: 'Account', cell: (a) => accountOf(a.accountId)?.name ?? 'Deleted account' },
    {
      id: 'model',
      header: 'Model',
      sortValue: (a) => a.model ?? '',
      cell: (a) => a.model ?? 'Provider default',
    },
    {
      id: 'groups',
      header: 'Groups',
      cell: (a) => (
        <span className="chips">
          {a.groupIds.map((g) => (
            <span key={g} className="chip">
              {groupName(g)}
            </span>
          ))}
        </span>
      ),
    },
    { id: 'policy', header: 'Agent policy', cell: (a) => policyOf(a.policyId) },
    {
      id: 'labels',
      header: 'Labels',
      cell: (a) => (
        <span className="chips">
          {a.labels.map((l) => (
            <span key={l} className="chip">
              {l}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: 'runs',
      header: 'Active runs',
      cell: (a) => String(state.data?.running.filter((r) => r.agentId === a.id).length ?? 0),
    },
    { id: 'updated', header: 'Updated', sortValue: (a) => a.updatedAt, cell: (a) => formatTime(a.updatedAt) },
  ];

  const done = (agent?: AgentDto) => {
    if (agent) {
      setForm(null);
      setSelected(agent.id);
      state.reload();
    }
  };

  return (
    <div className="screen">
      <Toolbar label="Agents toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('create');
          }}
        >
          Create agent
        </button>
        <FilterInput
          label="Search agents"
          placeholder="Search name, slug, handle, persona (/)"
          value={search}
          onChange={setSearch}
        />
        <FilterSelect
          label="Role"
          value={role}
          onChange={setRole}
          options={['leader', 'worker', 'reviewer'].map((r) => ({ value: r, label: r }))}
        />
        <FilterSelect
          label="Enabled"
          value={enabled}
          onChange={setEnabled}
          options={[
            { value: 'true', label: 'Enabled' },
            { value: 'false', label: 'Disabled' },
          ]}
        />
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load agents. Retry.">
          {() =>
            all.length === 0 ? (
              <EmptyState title="No agents yet. Create an agent." />
            ) : rows.length === 0 ? (
              <EmptyState title="No matches. Clear filters to see all items." />
            ) : (
              <Table
                label="Agents"
                columns={columns}
                rows={rows}
                getRowId={(a) => a.id}
                selectedId={selected}
                onSelect={(a) => {
                  setSelected(a.id);
                }}
                defaultSort={{ columnId: 'name', direction: 'asc' }}
              />
            )
          }
        </Resource>
      </div>
      {selected ? (
        <AgentDetails
          agentId={selected}
          agent={selectedAgent}
          onClose={() => {
            setSelected(null);
          }}
          onOpenRun={(runId) => {
            openDock({ title: `Run log ${runId.slice(0, 8)}`, body: <RunLog key={runId} runId={runId} /> });
          }}
          footer={
            selectedAgent ? (
              <>
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
                  className="btn"
                  disabled={mutation.pending}
                  onClick={() => {
                    void mutation
                      .run(() => api.agents.update(selectedAgent.id, { enabled: !selectedAgent.enabled }))
                      .then(() => {
                        state.reload();
                      });
                  }}
                >
                  {selectedAgent.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={mutation.pending}
                  onClick={() => {
                    void mutation
                      .run(() => api.agents.setPaused(selectedAgent.id, !selectedAgent.paused))
                      .then(() => {
                        state.reload();
                      });
                  }}
                >
                  {selectedAgent.paused ? 'Resume' : 'Pause'}
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
                {mutation.error && !form ? (
                  <span className="form-error">{errorMessage(mutation.error)}</span>
                ) : null}
              </>
            ) : null
          }
        />
      ) : null}
      {form && state.data ? (
        <AgentForm
          agent={form === 'edit' ? selectedAgent : undefined}
          accounts={state.data.accounts}
          groups={state.data.groups}
          policies={state.data.policies}
          pending={mutation.pending}
          error={mutation.error}
          onCreate={(body) => {
            void mutation.run(() => api.agents.create(body)).then(done);
          }}
          onUpdate={(id, body) => {
            void mutation.run(() => api.agents.update(id, body)).then(done);
          }}
          onCancel={() => {
            setForm(null);
          }}
        />
      ) : null}
      {confirmDelete && selectedAgent ? (
        <ConfirmDialog
          title={`Delete ${selectedAgent.name}?`}
          message={`Delete ${selectedAgent.name}? Its run history stays inspectable.`}
          confirmLabel="Delete agent"
          cancelLabel="Keep agent"
          busy={mutation.pending}
          error={mutation.error ? errorMessage(mutation.error) : undefined}
          onCancel={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            void mutation
              .ok(() => api.agents.remove(selectedAgent.id))
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
