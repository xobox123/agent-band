import type { SkillDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
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
import { bundleFromFiles } from '../../lib/files.ts';
import { formatBytes, formatTime, shortId } from '../../lib/format.ts';

function ImportForm({
  existing,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  existing?: SkillDto | undefined;
  pending: boolean;
  error: unknown;
  onSubmit: (v: { name: string; description: string; files: File[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const errors: Record<string, string> = {};
  if (name.trim() === '') errors['name'] = 'Name is required.';
  if (files.length === 0) errors['files'] = 'Choose a zip archive or the skill files.';
  return (
    <FormDialog
      title={existing ? `New version of ${existing.name}` : 'Import skill'}
      submitLabel={existing ? 'Upload version' : 'Import'}
      pending={pending}
      error={error}
      errors={errors}
      codeFields={{ skill_unchanged: 'files' }}
      onCancel={onCancel}
      onSubmit={() => {
        onSubmit({ name: name.trim(), description, files });
      }}
    >
      <Field label="Name" name="name">
        <input
          className="field"
          value={name}
          disabled={Boolean(existing)}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Description" name="description">
        <input
          className="field"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
      </Field>
      <div className="wide form-field">
        <Field
          label="Bundle"
          name="files"
          help="One .zip, or the skill files. SKILL.md is required at the root. Skills are instructions and code; policy controls execution."
        >
          <input
            className="field"
            type="file"
            multiple
            aria-label="Skill bundle"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
            }}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function AssignForm({
  skill,
  agents,
  groups,
  onDone,
}: {
  skill: SkillDto;
  agents: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  onDone: () => void;
}) {
  const api = useApi();
  const mutation = useMutation();
  const [scope, setScope] = useState<'org' | 'group' | 'agent'>('org');
  const [targetId, setTargetId] = useState('');
  const [pin, setPin] = useState('');
  const options = scope === 'group' ? groups : agents;
  const valid = scope === 'org' || targetId !== '';
  return (
    <div className="panel-row">
      <select
        className="field"
        aria-label="Assignment scope"
        value={scope}
        onChange={(e) => {
          setScope(e.target.value as 'org' | 'group' | 'agent');
          setTargetId('');
        }}
      >
        <option value="org">Organization</option>
        <option value="group">Agent group</option>
        <option value="agent">Agent</option>
      </select>
      {scope === 'org' ? null : (
        <select
          className="field"
          aria-label="Assignment target"
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
          }}
        >
          <option value="">Select</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <input
        className="field"
        aria-label="Pinned version"
        placeholder="Always current"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value);
        }}
        size={12}
      />
      <button
        type="button"
        className="btn"
        disabled={!valid || mutation.pending}
        onClick={() => {
          void mutation
            .ok(() =>
              api.skills.assign({
                skillId: skill.id,
                scope:
                  scope === 'org'
                    ? { org: true }
                    : scope === 'group'
                      ? { agentGroupId: targetId }
                      : { agentId: targetId },
                ...(pin !== '' && /^[1-9]\d*$/.test(pin) ? { pinnedVersion: Number(pin) } : {}),
              }),
            )
            .then((ok) => {
              if (ok) onDone();
            });
        }}
      >
        Assign
      </button>
      {mutation.error ? <span className="form-error">{errorMessage(mutation.error)}</span> : null}
    </div>
  );
}

export function SkillsScreen() {
  const api = useApi();
  const list = useResource(() => api.skills.list(), [], ['skill.']);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'import' | 'version' | null>(null);
  const detail = useResource(
    () => (selected ? api.skills.get(selected) : Promise.resolve(null)),
    [selected],
    ['skill.'],
  );
  const assignments = useResource(
    async () => {
      if (!selected) return null;
      const [a, agents, groups] = await Promise.all([
        api.skills.assignments(selected),
        api.agents.list(),
        api.groups.list(),
      ]);
      return { assignments: a.items, agents: agents.items, groups: groups.items };
    },
    [selected],
    ['skill.', 'agent'],
  );
  const mutation = useMutation();

  const text = search.trim().toLowerCase();
  const all = list.data?.items ?? [];
  const rows = all.filter((s) => text === '' || `${s.name} ${s.description}`.toLowerCase().includes(text));
  useItemCount(list.data ? rows.length : null);
  const skill = all.find((s) => s.id === selected);

  const columns: Column<SkillDto>[] = [
    { id: 'name', header: 'Name', sortValue: (s) => s.name, cell: (s) => s.name },
    { id: 'description', header: 'Description', sortValue: (s) => s.description, cell: (s) => s.description },
    {
      id: 'version',
      header: 'Current version',
      sortValue: (s) => s.currentVersion,
      cell: (s) => `v${String(s.currentVersion)}`,
    },
    { id: 'created', header: 'Created', sortValue: (s) => s.createdAt, cell: (s) => formatTime(s.createdAt) },
  ];

  const scopeLabel = (scope: Record<string, unknown>) => {
    const d = assignments.data;
    if ('org' in scope) return 'Organization';
    if ('agentGroupId' in scope) {
      const id = String(scope.agentGroupId);
      return `Group: ${d?.groups.find((g) => g.id === id)?.name ?? shortId(id)}`;
    }
    const id = String(scope.agentId);
    return `Agent: ${d?.agents.find((a) => a.id === id)?.name ?? shortId(id)}`;
  };

  return (
    <div className="screen">
      <Toolbar label="Skills toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('import');
          }}
        >
          Import skill
        </button>
        <FilterInput
          label="Search skills"
          placeholder="Search name, description (/)"
          value={search}
          onChange={setSearch}
        />
        <button type="button" className="btn" onClick={list.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={list} errorMessage="Could not load skills. Retry.">
          {() =>
            all.length === 0 ? (
              <EmptyState title="No skills yet. Import a skill." />
            ) : rows.length === 0 ? (
              <EmptyState title="No matches. Clear filters to see all items." />
            ) : (
              <Table
                label="Skills"
                columns={columns}
                rows={rows}
                getRowId={(s) => s.id}
                selectedId={selected}
                onSelect={(s) => {
                  setSelected(s.id);
                }}
                defaultSort={{ columnId: 'name', direction: 'asc' }}
              />
            )
          }
        </Resource>
      </div>
      {skill ? (
        <DetailsPanel
          title={skill.name}
          subtitle={skill.id}
          onClose={() => {
            setSelected(null);
          }}
          footer={
            <button
              type="button"
              className="btn"
              onClick={() => {
                mutation.clearError();
                setForm('version');
              }}
            >
              Upload new version
            </button>
          }
        >
          <p>{skill.description || 'No description'}</p>
          <h3 className="section-title">Versions</h3>
          <Resource state={detail} errorMessage="Could not load versions. Retry.">
            {(d) =>
              d ? (
                <table className="table-plain" aria-label="Skill versions">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Hash</th>
                      <th>Source</th>
                      <th>Size</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.versions]
                      .sort((a, b) => b.version - a.version)
                      .map((v) => (
                        <tr key={v.version}>
                          <td>{`v${String(v.version)}`}</td>
                          <td className="mono" title={v.contentHash}>
                            {v.contentHash.slice(0, 12)}
                          </td>
                          <td title={v.origin ?? undefined}>{v.source}</td>
                          <td>{formatBytes(v.sizeBytes)}</td>
                          <td>{formatTime(v.createdAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : null
            }
          </Resource>
          <h3 className="section-title">Assignments</h3>
          <Resource state={assignments} errorMessage="Could not load assignments. Retry.">
            {(d) =>
              d ? (
                <>
                  {d.assignments.length === 0 ? (
                    <p className="dim">No assignments. Imports never assign automatically.</p>
                  ) : null}
                  <ul className="plain-list">
                    {d.assignments.map((a) => (
                      <li key={a.id} className="panel-row">
                        <span>{`${scopeLabel(a.scope)} · ${a.pinnedVersion ? `pinned v${String(a.pinnedVersion)}` : 'always current'}`}</span>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Remove assignment ${a.id}`}
                          disabled={mutation.pending}
                          onClick={() => {
                            void mutation.ok(() => api.skills.unassign(a.id)).then(assignments.reload);
                          }}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  <AssignForm skill={skill} agents={d.agents} groups={d.groups} onDone={assignments.reload} />
                </>
              ) : null
            }
          </Resource>
        </DetailsPanel>
      ) : null}
      {form ? (
        <ImportForm
          existing={form === 'version' ? skill : undefined}
          pending={mutation.pending}
          error={mutation.error}
          onCancel={() => {
            setForm(null);
          }}
          onSubmit={(v) => {
            void mutation
              .run(async () => {
                const bundle = await bundleFromFiles(v.files);
                const description = v.description === '' ? {} : { description: v.description };
                return form === 'version' && skill
                  ? api.skills.newVersion(skill.id, { ...description, ...bundle })
                  : api.skills.import({ name: v.name, ...description, ...bundle });
              })
              .then((saved) => {
                if (saved) {
                  setForm(null);
                  setSelected(saved.id);
                  list.reload();
                  detail.reload();
                }
              });
          }}
        />
      ) : null}
    </div>
  );
}
