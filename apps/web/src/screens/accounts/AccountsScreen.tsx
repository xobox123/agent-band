import type { AccountDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { Badge } from '../../components/Badge.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Resource } from '../../components/Resource.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { copyText, formatTime } from '../../lib/format.ts';
import { exactCount } from '../board/format.ts';
import {
  AccountActions,
  AccountIdentity,
  AccountLimits,
  UsageExtras,
} from '../../components/AccountStatus.tsx';
import { planLabel } from '../../lib/account.ts';
import { formatCost } from '../../lib/format.ts';
import { CliDiagnostics } from './CliDiagnostics.tsx';
import { AccountForm, type FollowUp } from './AccountForm.tsx';

export function AccountsScreen() {
  const api = useApi();
  const state = useResource(
    async () => {
      const [accounts, providers, dashboard] = await Promise.all([
        api.accounts.list(),
        api.providers(),
        api.dashboard().catch(() => null),
      ]);
      return { accounts: accounts.items, providers: providers.items, dashboard };
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
  const dashRow = state.data?.dashboard?.accounts.find((a) => a.account.id === selected);
  const providerName = (id: string) => state.data?.providers.find((p) => p.id === id)?.displayName ?? id;

  const columns: Column<AccountDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (a) => a.name,
      cell: (a) => (
        <>
          {a.name} {a.paused ? <Badge tone="warn">Paused</Badge> : null}
        </>
      ),
    },
    {
      id: 'provider',
      header: 'Provider',
      sortValue: (a) => a.provider,
      cell: (a) => providerName(a.provider),
    },
    { id: 'type', header: 'Type', sortValue: (a) => a.type, cell: (a) => a.type },
    {
      id: 'login',
      header: 'Login',
      cell: (a) =>
        a.connection ? (
          <span>
            <span className="conn-dot" data-ok={String(a.connection.loggedIn)} aria-hidden="true" />{' '}
            {a.connection.loggedIn
              ? [a.connection.email, planLabel(a.provider, a.connection.plan)].filter(Boolean).join(' - ') ||
                'Logged in'
              : 'Not logged in'}
          </span>
        ) : (
          <span className="dim">Not checked</span>
        ),
    },
    { id: 'secret', header: 'Secret', cell: (a) => (a.hasSecret ? 'Stored' : 'None') },
    { id: 'slots', header: 'Max runs', cell: (a) => String(a.limits.maxConcurrentRuns) },
    {
      id: 'budget',
      header: 'Daily budget',
      cell: (a) => (a.limits.dailyTokenBudget ? exactCount(a.limits.dailyTokenBudget) : 'No budget set'),
    },
    { id: 'updated', header: 'Updated', sortValue: (a) => a.updatedAt, cell: (a) => formatTime(a.updatedAt) },
  ];

  const [autoLogin, setAutoLogin] = useState<'console' | 'subscription' | undefined>();
  const afterSave = (saved?: AccountDto, followUp: FollowUp = null) => {
    if (saved) {
      setForm(null);
      setSelected(saved.id);
      setAutoLogin(
        followUp === 'login-console' ? 'console' : followUp === 'login' ? 'subscription' : undefined,
      );
      if (followUp === 'probe') void api.accounts.probe(saved.id).then(state.reload, state.reload);
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
        <CliDiagnostics />
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
          subtitle={`${providerName(account.provider)} · ${account.type === 'api' ? 'API key' : 'subscription'}`}
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
                className="btn"
                disabled={mutation.pending}
                onClick={() => {
                  void mutation
                    .run(() => api.accounts.setPaused(account.id, !account.paused))
                    .then(() => {
                      state.reload();
                    });
                }}
              >
                {account.paused ? 'Resume' : 'Pause'}
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
          <AccountIdentity account={account} />
          {account.type === 'cli' ? (
            <>
              <AccountLimits
                account={account}
                windows={dashRow?.windows ?? []}
                updatedAt={dashRow?.windowsUpdatedAt ?? null}
              />
              <UsageExtras account={account} />
            </>
          ) : null}
          <AccountActions key={account.id} account={account} onChanged={state.reload} autoLogin={autoLogin} />
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
            <dt>Cost</dt>
            <dd>
              {account.type === 'api'
                ? `${formatCost(dashRow?.costToday)} today, ${formatCost(dashRow?.costThisMonth)} this month`
                : 'Subscription'}
            </dd>
            <dt>Provider identity</dt>
            <dd>{account.providerIdentity ?? 'Not recorded'}</dd>
            <dt>Labels</dt>
            <dd>{account.labels.join(', ') || 'No labels'}</dd>
            <dt>Provider config</dt>
            <dd>
              <pre className="prompt">{JSON.stringify(account.providerConfig, null, 2)}</pre>
            </dd>
          </dl>
          <div className="id-row">
            <span className="dim">ID</span>
            <code className="mono-wrap">{account.id}</code>
            <button
              type="button"
              className="btn"
              aria-label="Copy account ID"
              onClick={() => {
                copyText(account.id);
              }}
            >
              Copy
            </button>
          </div>
        </DetailsPanel>
      ) : null}
      {form && state.data ? (
        <AccountForm
          account={form === 'edit' ? account : undefined}
          providers={state.data.providers}
          pending={mutation.pending}
          error={mutation.error}
          onCreate={(body, followUp) => {
            void mutation
              .run(() => api.accounts.create(body))
              .then((saved) => {
                afterSave(saved, followUp);
              });
          }}
          onUpdate={(id, body) => {
            void mutation
              .run(() => api.accounts.update(id, body))
              .then((saved) => {
                afterSave(saved);
              });
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
