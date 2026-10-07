import type { PolicyDetailDto, PolicyDto, PolicyRules } from '@agent-band/contracts';
import { useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import { Resource } from '../../components/Resource.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime, splitList } from '../../lib/format.ts';

type Mode = '' | 'read-only' | 'edit' | 'full-auto';

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function rulesFromForm(f: {
  workDirs: string;
  maxMode: Mode;
  allowedTools: string;
  deniedTools: string;
  dailyTokenBudget: string;
  maxRunMinutes: string;
}): PolicyRules {
  const rules: PolicyRules = {};
  if (f.workDirs.trim() !== '') rules.workDirs = lines(f.workDirs);
  if (f.maxMode !== '') rules.maxMode = f.maxMode;
  if (f.allowedTools.trim() !== '') rules.allowedTools = splitList(f.allowedTools);
  if (f.deniedTools.trim() !== '') rules.deniedTools = splitList(f.deniedTools);
  if (f.dailyTokenBudget !== '') rules.dailyTokenBudget = Number(f.dailyTokenBudget);
  if (f.maxRunMinutes !== '') rules.maxRunMinutes = Number(f.maxRunMinutes);
  return rules;
}

function PolicyForm({
  policy,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  policy?: PolicyDetailDto | undefined;
  pending: boolean;
  error: unknown;
  onSubmit: (v: { name: string; description: string; rules: PolicyRules }) => void;
  onCancel: () => void;
}) {
  const r = policy?.rules ?? {};
  const [name, setName] = useState(policy?.name ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [workDirs, setWorkDirs] = useState((r.workDirs ?? []).join('\n'));
  const [maxMode, setMaxMode] = useState<Mode>(r.maxMode ?? '');
  const [allowedTools, setAllowedTools] = useState((r.allowedTools ?? []).join(', '));
  const [deniedTools, setDeniedTools] = useState((r.deniedTools ?? []).join(', '));
  const [budget, setBudget] = useState(r.dailyTokenBudget === undefined ? '' : String(r.dailyTokenBudget));
  const [minutes, setMinutes] = useState(r.maxRunMinutes === undefined ? '' : String(r.maxRunMinutes));
  const errors: Record<string, string> = {};
  if (name.trim() === '') errors['name'] = 'Name is required.';
  if (lines(workDirs).some((d) => !d.startsWith('/')))
    errors['workDirs'] = 'Work directories must be absolute paths.';
  if (budget !== '' && !/^\d+$/.test(budget))
    errors['dailyTokenBudget'] = 'Daily token budget must be a non-negative integer.';
  if (minutes !== '' && !/^[1-9]\d*$/.test(minutes))
    errors['maxRunMinutes'] = 'Max run minutes must be a positive integer.';

  return (
    <FormDialog
      title={policy ? `Edit ${policy.name}` : 'Create policy'}
      submitLabel={policy ? 'Save as new version' : 'Create policy'}
      pending={pending}
      error={error}
      errors={errors}
      fieldAlias={(p) => p.replace(/^rules\./, '').replace(/\.\d+$/, '')}
      onCancel={onCancel}
      onSubmit={() => {
        onSubmit({
          name: name.trim(),
          description,
          rules: rulesFromForm({
            workDirs,
            maxMode,
            allowedTools,
            deniedTools,
            dailyTokenBudget: budget,
            maxRunMinutes: minutes,
          }),
        });
      }}
    >
      <Field label="Name" name="name">
        <input
          className="field"
          value={name}
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
          label="Work directories"
          name="workDirs"
          help="One absolute path per line. Empty means not set."
        >
          <textarea
            className="field mono"
            rows={3}
            value={workDirs}
            onChange={(e) => {
              setWorkDirs(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="Max mode" name="maxMode">
        <select
          className="field"
          value={maxMode}
          onChange={(e) => {
            setMaxMode(e.target.value as Mode);
          }}
        >
          <option value="">Not set</option>
          <option value="read-only">read-only</option>
          <option value="edit">edit</option>
          <option value="full-auto">full-auto</option>
        </select>
      </Field>
      <Field label="Daily token budget" name="dailyTokenBudget">
        <input
          className="field"
          inputMode="numeric"
          value={budget}
          onChange={(e) => {
            setBudget(e.target.value);
          }}
        />
      </Field>
      <Field label="Allowed tools" name="allowedTools" help="Comma separated.">
        <input
          className="field"
          value={allowedTools}
          onChange={(e) => {
            setAllowedTools(e.target.value);
          }}
        />
      </Field>
      <Field label="Denied tools" name="deniedTools" help="Comma separated. Deny wins.">
        <input
          className="field"
          value={deniedTools}
          onChange={(e) => {
            setDeniedTools(e.target.value);
          }}
        />
      </Field>
      <Field label="Max run minutes" name="maxRunMinutes">
        <input
          className="field"
          inputMode="numeric"
          value={minutes}
          onChange={(e) => {
            setMinutes(e.target.value);
          }}
        />
      </Field>
    </FormDialog>
  );
}

export function PoliciesScreen() {
  const api = useApi();
  const list = useResource(() => api.policies.list(), [], ['policy.']);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);
  const detail = useResource(
    () => (selected ? api.policies.get(selected) : Promise.resolve(null)),
    [selected],
    ['policy.'],
  );
  const mutation = useMutation();
  const rows = list.data?.items ?? [];
  useItemCount(list.data ? rows.length : null);

  const columns: Column<PolicyDto>[] = [
    { id: 'name', header: 'Name', sortValue: (p) => p.name, cell: (p) => p.name },
    { id: 'description', header: 'Description', cell: (p) => p.description },
    {
      id: 'version',
      header: 'Current version',
      sortValue: (p) => p.currentVersion,
      cell: (p) => `v${String(p.currentVersion)}`,
    },
    { id: 'updated', header: 'Updated', sortValue: (p) => p.updatedAt, cell: (p) => formatTime(p.updatedAt) },
  ];

  const policy = detail.data;

  return (
    <div className="screen">
      <Toolbar label="Policies toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('create');
          }}
        >
          Create policy
        </button>
        <button type="button" className="btn" onClick={list.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={list} errorMessage="Could not load policies. Retry.">
          {() =>
            rows.length === 0 ? (
              <EmptyState title="No policies yet. Create a policy." />
            ) : (
              <Table
                label="Policies"
                columns={columns}
                rows={rows}
                getRowId={(p) => p.id}
                selectedId={selected}
                onSelect={(p) => {
                  setSelected(p.id);
                }}
                defaultSort={{ columnId: 'name', direction: 'asc' }}
              />
            )
          }
        </Resource>
      </div>
      {selected ? (
        <DetailsPanel
          title={policy?.name ?? 'Policy'}
          subtitle={selected}
          onClose={() => {
            setSelected(null);
          }}
          footer={
            policy ? (
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
            ) : null
          }
        >
          <Resource state={detail} errorMessage="Could not load this policy. Retry.">
            {(p) =>
              p ? (
                <>
                  <p>{p.description || 'No description'}</p>
                  <h3 className="section-title">Current rules</h3>
                  <pre className="prompt">{JSON.stringify(p.rules, null, 2)}</pre>
                  <h3 className="section-title">Versions</h3>
                  <table className="table-plain" aria-label="Policy versions">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Created</th>
                        <th>Rules</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...p.versions]
                        .sort((a, b) => b.version - a.version)
                        .map((v) => (
                          <tr key={v.version}>
                            <td>{`v${String(v.version)}${v.version === p.currentVersion ? ' (current)' : ''}`}</td>
                            <td>{formatTime(v.createdAt)}</td>
                            <td>
                              <details>
                                <summary>Show</summary>
                                <pre className="log-text">{JSON.stringify(v.rules, null, 2)}</pre>
                              </details>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              ) : null
            }
          </Resource>
        </DetailsPanel>
      ) : null}
      {form ? (
        <PolicyForm
          policy={form === 'edit' ? (policy ?? undefined) : undefined}
          pending={mutation.pending}
          error={mutation.error}
          onCancel={() => {
            setForm(null);
          }}
          onSubmit={(v) => {
            if (form === 'edit' && policy) {
              void mutation
                .run(() => api.policies.update(policy.id, v))
                .then((saved) => {
                  if (saved) {
                    setForm(null);
                    detail.reload();
                    list.reload();
                  }
                });
            } else {
              void mutation
                .run(() => api.policies.create(v))
                .then((saved) => {
                  if (saved) {
                    setForm(null);
                    setSelected(saved.id);
                    list.reload();
                  }
                });
            }
          }}
        />
      ) : null}
    </div>
  );
}
