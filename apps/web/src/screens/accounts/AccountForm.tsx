import type { AccountDto, CreateAccountBody, ProviderDto, UpdateAccountBody } from '@agent-band/contracts';
import { useState } from 'react';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import { splitList } from '../../lib/format.ts';

interface FieldSpec {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'list' | 'enum';
  options: string[];
  required: boolean;
}

/** Reads the provider's JSON Schema (properties only) into form field specs. */
export function fieldSpecs(schema: unknown): FieldSpec[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const { properties, required } = schema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  return Object.entries(properties ?? {}).map(([name, prop]) => {
    const options = Array.isArray(prop.enum) ? (prop.enum as string[]) : [];
    let kind: FieldSpec['kind'] = 'string';
    if (options.length > 0) kind = 'enum';
    else if (prop.type === 'array') kind = 'list';
    else if (prop.type === 'number' || prop.type === 'integer') kind = 'number';
    else if (prop.type === 'boolean') kind = 'boolean';
    return { name, kind, options, required: required?.includes(name) ?? false };
  });
}

function toText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

interface Props {
  account?: AccountDto | undefined;
  providers: ProviderDto[];
  pending: boolean;
  error: unknown;
  onCreate: (body: CreateAccountBody) => void;
  onUpdate: (id: string, body: UpdateAccountBody) => void;
  onCancel: () => void;
}

export function AccountForm({ account, providers, pending, error, onCreate, onUpdate, onCancel }: Props) {
  const [name, setName] = useState(account?.name ?? '');
  const [providerId, setProviderId] = useState(account?.provider ?? providers[0]?.id ?? '');
  const provider = providers.find((p) => p.id === providerId);
  const [type, setType] = useState<'cli' | 'api'>(account?.type ?? provider?.accountTypes[0] ?? 'cli');
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(account?.providerConfig ?? {}).map(([k, v]) => [k, toText(v)])),
  );
  const [configDir, setConfigDir] = useState(account?.configDir ?? '');
  const [secret, setSecret] = useState('');
  const [labels, setLabels] = useState((account?.labels ?? []).join(', '));
  const [budget, setBudget] = useState(String(account?.limits.dailyTokenBudget ?? ''));
  const [concurrent, setConcurrent] = useState(String(account?.limits.maxConcurrentRuns ?? 1));
  const [touched, setTouched] = useState(false);

  const specs = fieldSpecs(provider?.accountFields);
  const typeOptions = provider?.accountTypes ?? ['cli', 'api'];
  const showSecret = provider?.secretField != null && type === 'api';

  let invalid: string | null = null;
  if (name.trim() === '') invalid = 'Name is required.';
  else if (!provider) invalid = 'Select a provider.';
  else if (specs.some((s) => s.required && s.kind !== 'boolean' && (config[s.name] ?? '') === '')) {
    invalid = 'Fill in all required provider fields.';
  } else if (!/^[1-9]\d*$/.test(concurrent)) invalid = 'Max concurrent runs must be a positive integer.';
  else if (budget !== '' && !/^[1-9]\d*$/.test(budget))
    invalid = 'Daily token budget must be a positive integer.';

  const providerConfig = () => {
    const out: Record<string, unknown> = {};
    for (const s of specs) {
      const raw = config[s.name] ?? '';
      if (raw === '' && s.kind !== 'boolean') continue;
      if (s.kind === 'list') out[s.name] = splitList(raw);
      else if (s.kind === 'number') out[s.name] = Number(raw);
      else if (s.kind === 'boolean') out[s.name] = raw === 'true';
      else out[s.name] = raw;
    }
    return out;
  };
  const limits = () => ({
    maxConcurrentRuns: Number(concurrent),
    ...(budget === '' ? {} : { dailyTokenBudget: Number(budget) }),
  });

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    if (account) {
      onUpdate(account.id, {
        name: name.trim(),
        providerConfig: providerConfig(),
        configDir: configDir === '' ? null : configDir,
        labels: splitList(labels),
        limits: limits(),
        ...(secret === '' ? {} : { secret }),
      });
    } else {
      onCreate({
        name: name.trim(),
        provider: providerId,
        type,
        providerConfig: providerConfig(),
        labels: splitList(labels),
        limits: limits(),
        ...(configDir === '' ? {} : { configDir }),
        ...(secret === '' ? {} : { secret }),
      });
    }
  };

  return (
    <FormDialog
      title={account ? `Edit ${account.name}` : 'Create account'}
      submitLabel={account ? 'Save account' : 'Create account'}
      pending={pending}
      error={error}
      invalid={touched ? invalid : null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Name">
        <input
          className="field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Provider"
        help={
          provider?.adapterEnabled === false ? 'Execution is not available for this provider yet.' : undefined
        }
      >
        <select
          className="field"
          value={providerId}
          disabled={Boolean(account)}
          onChange={(e) => {
            setProviderId(e.target.value);
            const next = providers.find((p) => p.id === e.target.value);
            if (next && !next.accountTypes.includes(type)) setType(next.accountTypes[0] ?? 'cli');
            setConfig({});
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <select
          className="field"
          value={type}
          disabled={Boolean(account)}
          onChange={(e) => {
            setType(e.target.value as 'cli' | 'api');
          }}
        >
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Config directory" help="Blank uses the CLI default login.">
        <input
          className="field mono"
          value={configDir}
          onChange={(e) => {
            setConfigDir(e.target.value);
          }}
        />
      </Field>
      {specs.map((s) => (
        <Field key={s.name} label={s.name} help={s.kind === 'list' ? 'Comma separated.' : undefined}>
          {s.kind === 'enum' ? (
            <select
              className="field"
              value={config[s.name] ?? ''}
              onChange={(e) => {
                setConfig((c) => ({ ...c, [s.name]: e.target.value }));
              }}
            >
              <option value="">Default</option>
              {s.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="field"
              type={s.kind === 'number' ? 'number' : 'text'}
              value={config[s.name] ?? ''}
              onChange={(e) => {
                setConfig((c) => ({ ...c, [s.name]: e.target.value }));
              }}
            />
          )}
        </Field>
      ))}
      {showSecret ? (
        <Field
          label={provider.secretField ?? 'Secret'}
          help={
            account?.hasSecret
              ? 'A secret is stored. Leave blank to keep it.'
              : 'Write-only. It is never shown again.'
          }
        >
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
            }}
          />
        </Field>
      ) : null}
      <Field label="Labels" help="Comma separated.">
        <input
          className="field"
          value={labels}
          onChange={(e) => {
            setLabels(e.target.value);
          }}
        />
      </Field>
      <Field label="Daily token budget" help="Blank means no budget.">
        <input
          className="field"
          inputMode="numeric"
          value={budget}
          onChange={(e) => {
            setBudget(e.target.value);
          }}
        />
      </Field>
      <Field label="Max concurrent runs">
        <input
          className="field"
          inputMode="numeric"
          value={concurrent}
          onChange={(e) => {
            setConcurrent(e.target.value);
          }}
        />
      </Field>
    </FormDialog>
  );
}
