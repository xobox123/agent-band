import type { Role, RoleBindingDto, TeamDto, UserDto } from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useMutation, useResource } from '../../hooks/useResource.ts';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { shortId } from '../../lib/format.ts';

type Tab = 'users' | 'teams' | 'bindings';
const ROLES: Role[] = ['owner', 'admin', 'operator', 'viewer'];

export function PeopleScreen() {
  const api = useApi();
  const state = useResource(
    async () => {
      const [users, teams, bindings, agents, groups] = await Promise.all([
        api.users(),
        api.teams.list(),
        api.roleBindings.list(),
        api.agents.list(),
        api.groups.list(),
      ]);
      return {
        users: users.items,
        teams: teams.items,
        bindings: bindings.items,
        agents: agents.items,
        groups: groups.items,
      };
    },
    [],
    ['org.', 'agent'],
  );
  const [tab, setTab] = useState<Tab>('users');
  const [form, setForm] = useState<'team' | 'binding' | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [subjectKind, setSubjectKind] = useState<'user' | 'team'>('user');
  const [subjectId, setSubjectId] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [scopeKind, setScopeKind] = useState<'org' | 'group' | 'agent'>('org');
  const [scopeId, setScopeId] = useState('');
  const [memberOf, setMemberOf] = useState<Record<string, string>>({});
  const mutation = useMutation();

  const d = state.data;
  useItemCount(
    d ? (tab === 'users' ? d.users.length : tab === 'teams' ? d.teams.length : d.bindings.length) : null,
  );

  const userName = (id: string) =>
    d?.users.find((u) => u.id === id)?.displayName ?? `Deleted user ${shortId(id)}`;
  const teamNameOf = (id: string) => d?.teams.find((t) => t.id === id)?.name ?? `Deleted team ${shortId(id)}`;

  const userColumns: Column<UserDto>[] = [
    { id: 'name', header: 'Name', sortValue: (u) => u.displayName, cell: (u) => u.displayName },
    {
      id: 'handle',
      header: 'Handle',
      sortValue: (u) => u.handle,
      cell: (u) => <span className="mono">{u.handle}</span>,
    },
    { id: 'email', header: 'Email', cell: (u) => u.email ?? 'No email' },
    { id: 'status', header: 'Status', cell: (u) => <StatusDot kind="user" value={u.status} /> },
  ];

  const bindingColumns: Column<RoleBindingDto>[] = [
    {
      id: 'subject',
      header: 'Subject',
      cell: (b) =>
        'userId' in b.subject
          ? `User: ${userName(b.subject.userId)}`
          : `Team: ${teamNameOf(b.subject.teamId)}`,
    },
    { id: 'role', header: 'Role', sortValue: (b) => b.role, cell: (b) => b.role },
    {
      id: 'scope',
      header: 'Scope',
      cell: (b) => {
        if ('org' in b.scope) return 'Organization';
        if ('agentGroupId' in b.scope) {
          const id = b.scope.agentGroupId;
          return `Group: ${d?.groups.find((g) => g.id === id)?.name ?? shortId(id)}`;
        }
        const id = b.scope.agentId;
        return `Agent: ${d?.agents.find((a) => a.id === id)?.name ?? shortId(id)}`;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (b) => (
        <button
          type="button"
          className="btn"
          aria-label={`Delete role binding ${b.id}`}
          onClick={() => {
            void mutation.ok(() => api.roleBindings.remove(b.id)).then(state.reload);
          }}
        >
          Delete
        </button>
      ),
    },
  ];

  const scopeOptions = scopeKind === 'group' ? (d?.groups ?? []) : (d?.agents ?? []);
  const bindingInvalid =
    subjectId === ''
      ? 'Select a subject.'
      : scopeKind !== 'org' && scopeId === ''
        ? 'Select a scope target.'
        : null;

  return (
    <div className="screen">
      <Toolbar label="People toolbar">
        <span className="segmented" role="group" aria-label="Section">
          {(
            [
              ['users', 'Users'],
              ['teams', 'Teams'],
              ['bindings', 'Role bindings'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn"
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </span>
        {tab === 'teams' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              mutation.clearError();
              setForm('team');
            }}
          >
            Create team
          </button>
        ) : null}
        {tab === 'bindings' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              mutation.clearError();
              setForm('binding');
            }}
          >
            Create role binding
          </button>
        ) : null}
        <button type="button" className="btn" onClick={state.reload}>
          Refresh
        </button>
        {mutation.error && !form ? <span className="form-error">{errorMessage(mutation.error)}</span> : null}
      </Toolbar>
      <div className="screen-body">
        <Resource state={state} errorMessage="Could not load people and teams. Retry.">
          {(data) => {
            if (tab === 'users') {
              return data.users.length === 0 ? (
                <EmptyState title="No users." />
              ) : (
                <Table
                  label="Users"
                  columns={userColumns}
                  rows={data.users}
                  getRowId={(u) => u.id}
                  defaultSort={{ columnId: 'name', direction: 'asc' }}
                />
              );
            }
            if (tab === 'teams') {
              return data.teams.length === 0 ? (
                <EmptyState title="No teams yet. Create a team." />
              ) : (
                <div className="cards">
                  {data.teams.map((t: TeamDto) => (
                    <article key={t.id} className="panel" aria-label={`Team ${t.name}`}>
                      <strong>{t.name}</strong>
                      <span className="dim">{t.description}</span>
                      <ul className="plain-list">
                        {t.memberIds.length === 0 ? <li className="dim">No members</li> : null}
                        {t.memberIds.map((m) => (
                          <li key={m}>{userName(m)}</li>
                        ))}
                      </ul>
                      <div className="panel-row">
                        <select
                          className="field"
                          aria-label={`Add member to ${t.name}`}
                          value={memberOf[t.id] ?? ''}
                          onChange={(e) => {
                            setMemberOf((cur) => ({ ...cur, [t.id]: e.target.value }));
                          }}
                        >
                          <option value="">Add a user</option>
                          {data.users
                            .filter((u) => !t.memberIds.includes(u.id))
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.displayName}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="btn"
                          disabled={(memberOf[t.id] ?? '') === '' || mutation.pending}
                          onClick={() => {
                            void mutation
                              .ok(() => api.teams.addMember(t.id, memberOf[t.id] ?? ''))
                              .then((ok) => {
                                if (ok) {
                                  setMemberOf((cur) => ({ ...cur, [t.id]: '' }));
                                  state.reload();
                                }
                              });
                          }}
                        >
                          Add member
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              );
            }
            return data.bindings.length === 0 ? (
              <EmptyState title="No role bindings." />
            ) : (
              <Table
                label="Role bindings"
                columns={bindingColumns}
                rows={data.bindings}
                getRowId={(b) => b.id}
              />
            );
          }}
        </Resource>
      </div>
      {form === 'team' ? (
        <FormDialog
          title="Create team"
          submitLabel="Create team"
          pending={mutation.pending}
          error={mutation.error}
          invalid={null}
          onCancel={() => {
            setForm(null);
          }}
          onSubmit={() => {
            if (teamName.trim() === '') return;
            void mutation
              .ok(() => api.teams.create({ name: teamName.trim(), description: teamDescription }))
              .then((ok) => {
                if (ok) {
                  setForm(null);
                  setTeamName('');
                  setTeamDescription('');
                  state.reload();
                }
              });
          }}
        >
          <Field label="Name">
            <input
              className="field"
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
              }}
            />
          </Field>
          <Field label="Description">
            <input
              className="field"
              value={teamDescription}
              onChange={(e) => {
                setTeamDescription(e.target.value);
              }}
            />
          </Field>
        </FormDialog>
      ) : null}
      {form === 'binding' && d ? (
        <FormDialog
          title="Create role binding"
          submitLabel="Create binding"
          pending={mutation.pending}
          error={mutation.error}
          invalid={bindingInvalid}
          onCancel={() => {
            setForm(null);
          }}
          onSubmit={() => {
            void mutation
              .ok(() =>
                api.roleBindings.create({
                  subject: subjectKind === 'user' ? { userId: subjectId } : { teamId: subjectId },
                  role,
                  scope:
                    scopeKind === 'org'
                      ? { org: true }
                      : scopeKind === 'group'
                        ? { agentGroupId: scopeId }
                        : { agentId: scopeId },
                }),
              )
              .then((ok) => {
                if (ok) {
                  setForm(null);
                  state.reload();
                }
              });
          }}
        >
          <Field label="Subject type">
            <select
              className="field"
              value={subjectKind}
              onChange={(e) => {
                setSubjectKind(e.target.value as 'user' | 'team');
                setSubjectId('');
              }}
            >
              <option value="user">User</option>
              <option value="team">Team</option>
            </select>
          </Field>
          <Field label="Subject">
            <select
              className="field"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
              }}
            >
              <option value="">Select</option>
              {(subjectKind === 'user'
                ? d.users.map((u) => ({ id: u.id, name: u.displayName }))
                : d.teams
              ).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <select
              className="field"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scope">
            <select
              className="field"
              value={scopeKind}
              onChange={(e) => {
                setScopeKind(e.target.value as 'org' | 'group' | 'agent');
                setScopeId('');
              }}
            >
              <option value="org">Organization</option>
              <option value="group">Agent group</option>
              <option value="agent">Agent</option>
            </select>
          </Field>
          {scopeKind === 'org' ? null : (
            <Field label="Scope target">
              <select
                className="field"
                value={scopeId}
                onChange={(e) => {
                  setScopeId(e.target.value);
                }}
              >
                <option value="">Select</option>
                {scopeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </FormDialog>
      ) : null}
    </div>
  );
}
