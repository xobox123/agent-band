import type { AgentGroupDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { FilterInput } from '../../components/FilterInput.tsx';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import { Resource } from '../../components/Resource.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime, shortId, splitList } from '../../lib/format.ts';

function GroupForm({
  group,
  policies,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  group?: AgentGroupDto | undefined;
  policies: { id: string; name: string }[];
  pending: boolean;
  error: unknown;
  onSubmit: (v: { name: string; description: string; labels: string[]; policyId: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [labels, setLabels] = useState((group?.labels ?? []).join(', '));
  const [policyId, setPolicyId] = useState(group?.policyId ?? '');
  const errors: Record<string, string> = name.trim() === '' ? { name: 'Name is required.' } : {};
  return (
    <FormDialog
      title={group ? `Edit ${group.name}` : 'Create group'}
      submitLabel={group ? 'Save group' : 'Create group'}
      pending={pending}
      error={error}
      errors={errors}
      onCancel={onCancel}
      onSubmit={() => {
        onSubmit({ name: name.trim(), description, labels: splitList(labels), policyId });
      }}
    >
      <Field label="Name" name="name" help="A shared group name.">
        <input
          className="field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Labels" name="labels" help="Comma separated.">
        <input
          className="field"
          value={labels}
          onChange={(e) => {
            setLabels(e.target.value);
          }}
        />
      </Field>
      <div className="wide form-field">
        <Field label="Description" name="description" help="Describe the group's purpose.">
          <textarea
            className="field"
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="Policy" name="policyId" help="Adds restrictions to every member.">
        <select
          className="field"
          value={policyId}
          onChange={(e) => {
            setPolicyId(e.target.value);
          }}
        >
          <option value="">No group restriction</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </FormDialog>
  );
}

export function GroupsScreen() {
  const api = useApi();
  const state = useResource(
    async () => {
      const [groups, agents, policies] = await Promise.all([
        api.groups.list(),
        api.agents.list(),
        api.policies.list(),
      ]);
      return { groups: groups.items, agents: agents.items, policies: policies.items };
    },
    [],
    ['agent'],
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addAgent, setAddAgent] = useState('');
  const mutation = useMutation();

  const text = search.trim().toLowerCase();
  const all = state.data?.groups ?? [];
  const rows = all.filter((g) => text === '' || `${g.name} ${g.description}`.toLowerCase().includes(text));
  useItemCount(state.data ? rows.length : null);
  const group = all.find((g) => g.id === selected);
  const policyName = (id: string | null) =>
    id
      ? (state.data?.policies.find((p) => p.id === id)?.name ?? `Deleted policy ${shortId(id)}`)
      : 'No group restriction';

  const columns: Column<AgentGroupDto>[] = [
    { id: 'name', header: 'Name', sortValue: (g) => g.name, cell: (g) => g.name },
    { id: 'description', header: 'Description', sortValue: (g) => g.description, cell: (g) => g.description },
    { id: 'members', header: 'Members', cell: (g) => String(g.agentIds.length) },
    {
      id: 'labels',
      header: 'Labels',
      cell: (g) => (
        <span className="chips">
          {g.labels.map((l) => (
            <span key={l} className="chip">
              {l}
            </span>
          ))}
        </span>
      ),
    },
    { id: 'policy', header: 'Group policy', cell: (g) => policyName(g.policyId) },
    { id: 'created', header: 'Created', sortValue: (g) => g.createdAt, cell: (g) => formatTime(g.createdAt) },
  ];

  const afterSave = (saved?: AgentGroupDto) => {
    if (saved) {
      setForm(null);
      setSelected(saved.id);
      state.reload();
    }
  };

  return (
    <div className="screen">
      <Toolbar label="Agent groups toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('create');
          }}
        >
          Create group
        </button>
        <FilterInput
          label="Search groups"
          placeholder="Search name, description (/)"
          value={search}
          onChange={setSearch}
        />
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load agent groups. Retry.">
          {() =>
            all.length === 0 ? (
              <EmptyState title="No agent groups yet. Create a group." />
            ) : rows.length === 0 ? (
              <EmptyState title="No matches. Clear filters to see all items." />
            ) : (
              <Table
                label="Agent groups"
                columns={columns}
                rows={rows}
                getRowId={(g) => g.id}
                selectedId={selected}
                onSelect={(g) => {
                  setSelected(g.id);
                }}
                defaultSort={{ columnId: 'name', direction: 'asc' }}
              />
            )
          }
        </Resource>
      </div>
      {group && state.data ? (
        <DetailsPanel
          title={group.name}
          subtitle={group.id}
          onClose={() => {
            setSelected(null);
          }}
          footer={
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
                className="btn btn-danger"
                onClick={() => {
                  mutation.clearError();
                  setConfirmDelete(true);
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <dl className="kv">
            <dt>Description</dt>
            <dd>{group.description || 'No description'}</dd>
            <dt>Policy</dt>
            <dd>{policyName(group.policyId)}</dd>
            <dt>Labels</dt>
            <dd>{group.labels.join(', ') || 'No labels'}</dd>
            <dt>Created</dt>
            <dd>{formatTime(group.createdAt)}</dd>
          </dl>
          <h3 className="section-title">Members</h3>
          {group.agentIds.length === 0 ? <p className="dim">This group has no agents.</p> : null}
          <ul className="plain-list">
            {group.agentIds.map((id) => {
              const agent = state.data?.agents.find((a) => a.id === id);
              return (
                <li key={id} className="panel-row">
                  <span>{agent ? `${agent.name} (${agent.handle})` : `Deleted agent ${shortId(id)}`}</span>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Remove ${agent?.name ?? id} from group`}
                    disabled={mutation.pending}
                    onClick={() => {
                      void mutation.run(() => api.groups.removeMember(group.id, id)).then(state.reload);
                    }}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="panel-row">
            <select
              className="field"
              aria-label="Agent to add"
              value={addAgent}
              onChange={(e) => {
                setAddAgent(e.target.value);
              }}
            >
              <option value="">Add an agent</option>
              {state.data.agents
                .filter((a) => !group.agentIds.includes(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={addAgent === '' || mutation.pending}
              onClick={() => {
                void mutation
                  .run(() => api.groups.addMember(group.id, addAgent))
                  .then(() => {
                    setAddAgent('');
                    state.reload();
                  });
              }}
            >
              Add member
            </button>
          </div>
          {mutation.error && !form ? <p className="form-error">{errorMessage(mutation.error)}</p> : null}
        </DetailsPanel>
      ) : null}
      {form && state.data ? (
        <GroupForm
          group={form === 'edit' ? group : undefined}
          policies={state.data.policies}
          pending={mutation.pending}
          error={mutation.error}
          onCancel={() => {
            setForm(null);
          }}
          onSubmit={(v) => {
            if (form === 'edit' && group) {
              void mutation
                .run(() =>
                  api.groups.update(group.id, {
                    name: v.name,
                    description: v.description,
                    labels: v.labels,
                    policyId: v.policyId === '' ? null : v.policyId,
                  }),
                )
                .then(afterSave);
            } else {
              void mutation
                .run(() =>
                  api.groups.create({
                    name: v.name,
                    description: v.description,
                    labels: v.labels,
                    ...(v.policyId ? { policyId: v.policyId } : {}),
                  }),
                )
                .then(afterSave);
            }
          }}
        />
      ) : null}
      {confirmDelete && group ? (
        <ConfirmDialog
          title={`Delete ${group.name}?`}
          message={`Delete ${group.name}? Member agents are not deleted.`}
          confirmLabel="Delete group"
          cancelLabel="Keep group"
          busy={mutation.pending}
          error={mutation.error ? errorMessage(mutation.error) : undefined}
          onCancel={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            void mutation
              .ok(() => api.groups.remove(group.id))
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
