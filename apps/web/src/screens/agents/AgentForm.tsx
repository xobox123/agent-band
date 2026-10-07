import type {
  AccountDto,
  AgentDto,
  AgentGroupDto,
  CreateAgentBody,
  PolicyDto,
  UpdateAgentBody,
} from '@agent-band/contracts';
import { useState } from 'react';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import { splitList, toggleIn } from '../../lib/format.ts';

interface Props {
  agent?: AgentDto | undefined;
  accounts: AccountDto[];
  groups: AgentGroupDto[];
  policies: PolicyDto[];
  pending: boolean;
  error: unknown;
  onCreate: (body: CreateAgentBody) => void;
  onUpdate: (id: string, body: UpdateAgentBody) => void;
  onCancel: () => void;
}

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
type Role = 'leader' | 'worker' | 'reviewer';

export function AgentForm({
  agent,
  accounts,
  groups,
  policies,
  pending,
  error,
  onCreate,
  onUpdate,
  onCancel,
}: Props) {
  const [name, setName] = useState(agent?.name ?? '');
  const [slug, setSlug] = useState(agent?.slug ?? '');
  const [avatar, setAvatar] = useState(agent?.avatar?.value ?? '');
  const [persona, setPersona] = useState(agent?.persona ?? '');
  const [accountId, setAccountId] = useState(agent?.accountId ?? accounts[0]?.id ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [role, setRole] = useState<Role>(agent?.role ?? 'worker');
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [labels, setLabels] = useState((agent?.labels ?? []).join(', '));
  const [groupIds, setGroupIds] = useState<string[]>(agent?.groupIds ?? []);
  const [policyId, setPolicyId] = useState(agent?.policyId ?? '');
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [gitName, setGitName] = useState(agent?.gitIdentity.name ?? '');
  const [gitEmail, setGitEmail] = useState(agent?.gitIdentity.email ?? '');
  const [touched, setTouched] = useState(false);

  let invalid: string | null = null;
  if (name.trim() === '') invalid = 'Name is required.';
  else if (!agent && !SLUG.test(slug)) invalid = 'Slug must be lowercase letters, digits and hyphens.';
  else if (accountId === '') invalid = 'Select an account.';
  else if ((gitName !== '' || gitEmail !== '') && (gitName === '' || gitEmail === '')) {
    invalid = 'Git name and email must be set together.';
  }

  const git = gitName !== '' && gitEmail !== '' ? { gitIdentity: { name: gitName, email: gitEmail } } : {};

  const structuredAvatar: import('@agent-band/contracts').AgentAvatar = {
    kind: /^https:\/\//.test(avatar.trim()) ? 'url' : /^av-\d+$/.test(avatar.trim()) ? 'color' : 'initials',
    value: avatar.trim(),
  };
  const submit = () => {
    setTouched(true);
    if (invalid) return;
    if (agent) {
      onUpdate(agent.id, {
        name: name.trim(),
        avatar: avatar.trim() === '' ? null : structuredAvatar,
        groupIds,
        accountId,
        model: model.trim() === '' ? null : model.trim(),
        role,
        persona: persona.trim() === '' ? null : persona.trim(),
        systemPrompt: systemPrompt === '' ? null : systemPrompt,
        labels: splitList(labels),
        policyId: policyId === '' ? null : policyId,
        enabled,
        ...git,
      });
    } else {
      onCreate({
        slug,
        name: name.trim(),
        accountId,
        role,
        labels: splitList(labels),
        groupIds,
        enabled,
        ...(avatar.trim() ? { avatar: structuredAvatar } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(persona.trim() ? { persona: persona.trim() } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(policyId ? { policyId } : {}),
        ...git,
      });
    }
  };

  return (
    <FormDialog
      title={agent ? `Edit ${agent.name}` : 'Create agent'}
      submitLabel={agent ? 'Save agent' : 'Create agent'}
      pending={pending}
      error={error}
      invalid={touched ? invalid : null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Name" help="A readable agent name.">
        <input
          className="field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Slug" help={agent ? 'Immutable.' : 'Creates the stable handle agent:<slug>.'}>
        <input
          className="field"
          value={slug}
          disabled={Boolean(agent)}
          onChange={(e) => {
            setSlug(e.target.value);
          }}
        />
      </Field>
      <Field label="Account" help="Shared account limits apply.">
        <select
          className="field"
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
          }}
        >
          <option value="">Select an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{`${a.name} (${a.provider})`}</option>
          ))}
        </select>
      </Field>
      <Field label="Model" help="Blank uses the provider default.">
        <input
          className="field"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
          }}
        />
      </Field>
      <Field label="Role" help="Workflow role, not a human access role.">
        <select
          className="field"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role);
          }}
        >
          <option value="leader">Leader</option>
          <option value="worker">Worker</option>
          <option value="reviewer">Reviewer</option>
        </select>
      </Field>
      <Field label="Avatar" help="Initials, an av-N colour token or an http(s) image URL.">
        <input
          className="field"
          value={avatar}
          onChange={(e) => {
            setAvatar(e.target.value);
          }}
        />
      </Field>
      <div className="wide form-field">
        <Field label="Persona" help="Who this agent is; this does not grant permissions.">
          <textarea
            className="field"
            rows={3}
            value={persona}
            onChange={(e) => {
              setPersona(e.target.value);
            }}
          />
        </Field>
      </div>
      <div className="wide form-field">
        <Field label="System prompt" help="Appended instructions; do not include credentials.">
          <textarea
            className="field"
            rows={3}
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="Labels" help="Comma separated. Tasks may target agents by label.">
        <input
          className="field"
          value={labels}
          onChange={(e) => {
            setLabels(e.target.value);
          }}
        />
      </Field>
      <Field label="Agent policy" help="Adds restrictions to org and group policies.">
        <select
          className="field"
          value={policyId}
          onChange={(e) => {
            setPolicyId(e.target.value);
          }}
        >
          <option value="">No agent restriction</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Git name" help="Git author and committer name.">
        <input
          className="field"
          value={gitName}
          onChange={(e) => {
            setGitName(e.target.value);
          }}
        />
      </Field>
      <Field label="Git email" help="Git author and committer email.">
        <input
          className="field"
          value={gitEmail}
          onChange={(e) => {
            setGitEmail(e.target.value);
          }}
        />
      </Field>
      <fieldset className="wide">
        <legend className="form-label">Groups</legend>
        {groups.length === 0 ? <span className="dim">No groups</span> : null}
        {groups.map((g) => (
          <label key={g.id} className="inline-field">
            <input
              type="checkbox"
              checked={groupIds.includes(g.id)}
              onChange={() => {
                setGroupIds((cur) => toggleIn(cur, g.id));
              }}
            />
            {g.name}
          </label>
        ))}
      </fieldset>
      <label className="inline-field">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
        Enabled
      </label>
    </FormDialog>
  );
}
