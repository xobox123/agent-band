import type { AccountDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Resource } from '../../components/Resource.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime } from '../../lib/format.ts';
import { exactCount } from '../board/format.ts';
import { AccountForm } from './AccountForm.tsx';

export function AccountsScreen() {
  const api = useApi();
  const state = useResource(
    async () => {
      const [accounts, providers] = await Promise.all([api.accounts.list(), api.providers()]);
      return { accounts: accounts.items, providers: providers.items };
    },
    [],
    ['account.'],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'edit' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mutation = useMutation();

  const rows = state.data?.accounts ?? [];
  useItemCount(state.data ? rows.length : null);
  const account = rows.find((a) => a.id === selected);
  const providerName = (id: string) => state.data?.providers.find((p) => p.id === id)?.displayName ?? id;

  const columns: Column<AccountDto>[] = [
    { id: 'name', header: 'Name', sortValue: (a) => a.name, cell: (a) => a.name },
    {
      id: 'provider',
      header: 'Provider',
      sortValue: (a) => a.provider,
      cell: (a) => providerName(a.provider),
    },
    { id: 'type', header: 'Type', sortValue: (a) => a.type, cell: (a) => a.type },
    { id: 'secret', header: 'Secret', cell: (a) => (a.hasSecret ? 'Stored' : 'None') },
    { id: 'slots', header: 'Max runs', cell: (a) => String(a.limits.maxConcurrentRuns) },
    {
      id: 'budget',
      header: 'Daily budget',
      cell: (a) => (a.limits.dailyTokenBudget ? exactCount(a.limits.dailyTokenBudget) : 'No budget set'),
    },
    { id: 'updated', header: 'Updated', sortValue: (a) => a.updatedAt, cell: (a) => formatTime(a.updatedAt) },
  ];

  const afterSave = (saved?: AccountDto) => {
    if (saved) {
      setForm(null);
      setSelected(saved.id);
      state.reload();
    }
  };

  return (
    <div className="screen">
      <Toolbar label="Accounts toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutation.clearError();
            setForm('create');
          }}
        >
          Create account
        </button>
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load accounts. Retry.">
          {() =>
            rows.length === 0 ? (
              <EmptyState title="No accounts yet. Create an account." />
            ) : (
              <Table
                label="Accounts"
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
      {account ? (
        <DetailsPanel
          title={account.name}
          subtitle={account.id}
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
              {mutation.error && !form && !confirmDelete ? (
                <span className="form-error">{errorMessage(mutation.error)}</span>
              ) : null}
            </>
          }
        >
          <dl className="kv">
            <dt>Provider</dt>
            <dd>{providerName(account.provider)}</dd>
            <dt>Type</dt>
            <dd>{account.type}</dd>
            <dt>Secret</dt>
            <dd>
              {account.hasSecret
                ? `Stored (updated ${formatTime(account.secretUpdatedAt)})`
                : 'No secret stored'}
            </dd>
            <dt>Config directory</dt>
            <dd className="mono-wrap">{account.configDir ?? 'CLI default'}</dd>
            <dt>Provider identity</dt>
            <dd>{account.providerIdentity ?? 'Not recorded'}</dd>
            <dt>Labels</dt>
            <dd>{account.labels.join(', ') || 'No labels'}</dd>
            <dt>Provider config</dt>
            <dd>
              <pre className="prompt">{JSON.stringify(account.providerConfig, null, 2)}</pre>
            </dd>
          </dl>
        </DetailsPanel>
      ) : null}
      {form && state.data ? (
        <AccountForm
          account={form === 'edit' ? account : undefined}
          providers={state.data.providers}
          pending={mutation.pending}
          error={mutation.error}
          onCreate={(body) => {
            void mutation.run(() => api.accounts.create(body)).then(afterSave);
          }}
          onUpdate={(id, body) => {
            void mutation.run(() => api.accounts.update(id, body)).then(afterSave);
          }}
          onCancel={() => {
            setForm(null);
          }}
        />
      ) : null}
      {confirmDelete && account ? (
        <ConfirmDialog
          title={`Delete ${account.name}?`}
          message={`Delete ${account.name}? Agents bound to it must be moved first.`}
          confirmLabel="Delete account"
          cancelLabel="Keep account"
          busy={mutation.pending}
          error={mutation.error ? errorMessage(mutation.error) : undefined}
          onCancel={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            void mutation
              .ok(() => api.accounts.remove(account.id))
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
