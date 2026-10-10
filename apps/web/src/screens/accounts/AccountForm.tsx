import { ProviderId } from '@agent-band/contracts';
import type {
  AccountDto,
  CreateAccountBody,
  ProbeResult,
  ProviderDto,
  UpdateAccountBody,
} from '@agent-band/contracts';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import { planLabel, suggestedLoginCommand } from '../../lib/account.ts';
import { copyText, splitList } from '../../lib/format.ts';

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

export type Method = 'current' | 'another' | 'api';
/** What the screen does right after the account exists. */
export type FollowUp = 'probe' | 'login' | 'login-console' | null;

/** Which connection methods a provider offers; `api` is disabled while its adapter cannot run it. */
export function methodsOf(provider: ProviderDto | undefined) {
  const types = provider?.accountTypes ?? [];
  const apiRunnable = provider ? !provider.adapterEnabled || provider.runnableTypes.includes('api') : false;
  return {
    cli: types.includes('cli'),
    api: types.includes('api'),
    apiDisabled: types.includes('api') && !apiRunnable,
  };
}

const METHOD_LABEL: Record<Method, string> = {
  current: 'Use my current login',
  another: 'Add another account',
  api: 'API key',
};

interface Props {
  account?: AccountDto | undefined;
  providers: ProviderDto[];
  pending: boolean;
  error: unknown;
  onCreate: (body: CreateAccountBody, followUp: FollowUp) => void;
  onUpdate: (id: string, body: UpdateAccountBody) => void;
  onCancel: () => void;
}

/** Maps server validation paths of an account body to the field names of the form. */
function accountFieldAlias(path: string): string {
  const fixed: Record<string, string> = {
    'limits.maxConcurrentRuns': 'concurrent',
    'limits.dailyTokenBudget': 'budget',
    'limits.dailyCostBudgetUsd': 'costBudget',
    'limits.stopAt.fiveHourPercent': 'stop5h',
    'limits.stopAt.weeklyPercent': 'stopWeek',
  };
  return fixed[path] ?? (path.startsWith('providerConfig.') ? `cfg.${path.slice(15)}` : path);
}

export function AccountForm({ account, providers, pending, error, onCreate, onUpdate, onCancel }: Props) {
  const [name, setName] = useState(account?.name ?? '');
  const [providerId, setProviderId] = useState(account?.provider ?? providers[0]?.id ?? '');
  const provider = providers.find((p) => p.id === providerId);
  const initialMethod = (p: ProviderDto | undefined): Method => {
    const m = methodsOf(p);
    return m.cli ? 'current' : 'api';
  };
  const [method, setMethod] = useState<Method>(
    account ? (account.type === 'api' ? 'api' : 'current') : initialMethod(provider),
  );
  const [loginMode, setLoginMode] = useState<'subscription' | 'console'>('subscription');
  const [advanced, setAdvanced] = useState(false);
  const [check, setCheck] = useState<{ pending: boolean; result?: ProbeResult; error?: string } | null>(null);
  const api = useApi();
  const type: 'cli' | 'api' = account ? account.type : method === 'api' ? 'api' : 'cli';
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(account?.providerConfig ?? {}).map(([k, v]) => [k, toText(v)])),
  );
  const [configDir, setConfigDir] = useState(account?.configDir ?? '');
  const [secret, setSecret] = useState('');
  const [labels, setLabels] = useState((account?.labels ?? []).join(', '));
  const [budget, setBudget] = useState(String(account?.limits.dailyTokenBudget ?? ''));
  const [costBudget, setCostBudget] = useState(String(account?.limits.dailyCostBudgetUsd ?? ''));
  const [stop5h, setStop5h] = useState(String(account?.limits.stopAt?.fiveHourPercent ?? ''));
  const [stopWeek, setStopWeek] = useState(String(account?.limits.stopAt?.weeklyPercent ?? ''));
  const [concurrent, setConcurrent] = useState(String(account?.limits.maxConcurrentRuns ?? 1));

  const specs = fieldSpecs(provider?.accountFields);
  const methods = methodsOf(provider);
  const showSecret = type === 'api' && (provider?.secretField != null || method === 'api');
  const secretLabel = provider?.secretField ?? 'API key';
  const isCliHarness =
    providerId === 'claude' ||
    providerId === 'openai' ||
    providerId === 'gemini' ||
    providerId === 'antigravity';
  const hasLimitWindows = (provider?.capabilities.limitWindows.length ?? 0) > 0;

  const errors: Record<string, string> = {};
  if (name.trim() === '') errors['name'] = 'Name is required.';
  if (!provider) errors['provider'] = 'Select a provider.';
  for (const spec of specs)
    if (spec.required && spec.kind !== 'boolean' && (config[spec.name] ?? '') === '')
      errors[`cfg.${spec.name}`] = `${spec.name} is required.`;
  if (!/^[1-9]\d*$/.test(concurrent))
    errors['concurrent'] = 'Max concurrent runs must be a positive integer.';
  if (budget !== '' && !/^[1-9]\d*$/.test(budget))
    errors['budget'] = 'Daily token budget must be a positive integer.';
  if (costBudget !== '' && !(Number(costBudget) > 0))
    errors['costBudget'] = 'Daily cost budget must be a positive number.';
  const thresholdBad = (v: string) =>
    v !== '' && !(/^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100);
  if (type === 'cli' && isCliHarness && hasLimitWindows && thresholdBad(stop5h))
    errors['stop5h'] = 'Must be between 1 and 100.';
  if (type === 'cli' && isCliHarness && hasLimitWindows && thresholdBad(stopWeek))
    errors['stopWeek'] = 'Must be between 1 and 100.';
  if (!account && type === 'api' && isCliHarness && secret.trim() === '')
    errors['secret'] = 'Enter the API key.';

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
    ...(costBudget === '' ? {} : { dailyCostBudgetUsd: Number(costBudget) }),
    ...(stop5h === '' && stopWeek === ''
      ? {}
      : {
          stopAt: {
            ...(stop5h === '' ? {} : { fiveHourPercent: Number(stop5h) }),
            ...(stopWeek === '' ? {} : { weeklyPercent: Number(stopWeek) }),
          },
        }),
  });

  const checkLogin = async () => {
    setCheck({ pending: true });
    try {
      const result = await api.accounts.probeConfig(
        type === 'api'
          ? { provider: ProviderId.parse(providerId), type, secret }
          : {
              provider: ProviderId.parse(providerId),
              type,
              ...(method === 'another' || configDir === '' ? {} : { configDir }),
            },
      );
      setCheck({ pending: false, result });
    } catch (err) {
      setCheck({ pending: false, error: errorMessage(err) });
    }
  };

  const submit = () => {
    if (account) {
      onUpdate(account.id, {
        name: name.trim(),
        providerConfig: providerConfig(),
        ...(type === 'cli' && account.configDir === null && configDir === ''
          ? {}
          : type === 'cli'
            ? { configDir: configDir === '' ? null : configDir }
            : {}),
        labels: splitList(labels),
        limits: limits(),
        ...(secret === '' ? {} : { secret }),
      });
    } else {
      const followUp: FollowUp =
        method === 'another' && isCliHarness
          ? loginMode === 'console' && providerId === 'claude'
            ? 'login-console'
            : 'login'
          : method === 'current' && isCliHarness
            ? 'probe'
            : null;
      onCreate(
        {
          name: name.trim(),
          provider: ProviderId.parse(providerId),
          type,
          providerConfig: providerConfig(),
          labels: splitList(labels),
          limits: limits(),
          ...(method === 'another' && isCliHarness ? { managedConfigDir: true } : {}),
          ...(method === 'current' && configDir !== '' ? { configDir } : {}),
          ...(secret === '' ? {} : { secret }),
        },
        followUp,
      );
    }
  };

  return (
    <FormDialog
      title={account ? `Edit ${account.name}` : 'Create account'}
      submitLabel={account ? 'Save account' : 'Create account'}
      pending={pending}
      error={error}
      errors={errors}
      fieldAlias={accountFieldAlias}
      onSubmit={submit}
      onCancel={onCancel}
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
      <Field
        label="Provider"
        name="provider"
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
            setMethod(initialMethod(next));
            setCheck(null);
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
      {account ? null : (
        <fieldset className="method-cards">
          <legend className="form-label">Connection method</legend>
          {(['current', 'another', 'api'] as const).map((m) => {
            const offered = m === 'api' ? methods.api : methods.cli;
            // agy keeps its login in the OS keyring: there is no way to add a second account.
            if (!offered || (m === 'another' && providerId === 'antigravity')) return null;
            const disabled = m === 'api' && methods.apiDisabled;
            return (
              <label
                key={m}
                className="method-card"
                data-selected={String(method === m)}
                aria-disabled={disabled}
              >
                <input
                  type="radio"
                  name="method"
                  checked={method === m}
                  disabled={disabled}
                  onChange={() => {
                    setMethod(m);
                    setCheck(null);
                  }}
                />
                <span>
                  <strong>{METHOD_LABEL[m]}</strong>
                  <span className="dim">
                    {disabled
                      ? ' Coming soon for this provider.'
                      : m === 'current'
                        ? providerId === 'antigravity'
                          ? ' Uses the Google login of the agy CLI on this machine (one account per machine).'
                          : ` Uses the login already on this machine (${{ openai: '~/.codex', gemini: '~/.gemini' }[providerId] ?? '~/.claude'}).`
                        : m === 'another'
                          ? providerId === 'gemini'
                            ? ' Log in a separate Google account in its own Gemini home.'
                            : ' Log in a separate account with your browser.'
                          : ' Pay per use with your own key.'}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {method === 'another' && !account && providerId === 'claude' ? (
        <Field label="Login type">
          <select
            className="field"
            value={loginMode}
            onChange={(e) => {
              setLoginMode(e.target.value as 'subscription' | 'console');
            }}
          >
            <option value="subscription">Claude subscription</option>
            <option value="console">Anthropic Console (API billing)</option>
          </select>
        </Field>
      ) : null}
      {method === 'another' && !account ? (
        <p className="dim">
          {providerId === 'gemini'
            ? `After saving, the exact login command is shown. Run it in a terminal, choose "Sign in with Google", then type /quit. Example: ${suggestedLoginCommand(providerId, name)}`
            : `After saving, a browser window opens to log in. To do it yourself: ${suggestedLoginCommand(providerId, name)}`}
        </p>
      ) : null}
      {type === 'cli' && isCliHarness && method !== 'another' ? (
        <>
          <div className="panel-row">
            <button
              type="button"
              className="btn"
              disabled={check?.pending === true}
              onClick={() => {
                void checkLogin();
              }}
            >
              Check login
            </button>
          </div>
          {check?.pending ? <p role="status">Checking...</p> : null}
          {check?.error ? (
            <p className="form-error" role="alert">
              {check.error}
            </p>
          ) : null}
          {check?.result ? <CheckResult provider={providerId} result={check.result} /> : null}
          <details
            open={advanced}
            onToggle={(e) => {
              setAdvanced(e.currentTarget.open);
            }}
          >
            <summary>Advanced</summary>
            <Field
              name="configDir"
              label="Config directory"
              help="Where the CLI stores this account's login. Not a project folder."
            >
              <input
                className="field mono"
                value={configDir}
                placeholder="Leave blank for the default"
                onChange={(e) => {
                  setConfigDir(e.target.value);
                }}
              />
            </Field>
          </details>
        </>
      ) : null}
      {specs.map((s) => (
        <Field
          key={s.name}
          name={`cfg.${s.name}`}
          label={s.name}
          help={s.kind === 'list' ? 'Comma separated.' : undefined}
        >
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
        <>
          <Field
            name="secret"
            label={secretLabel}
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
          {isCliHarness ? (
            <>
              <div className="panel-row">
                <button
                  type="button"
                  className="btn"
                  disabled={check?.pending === true || secret === ''}
                  onClick={() => {
                    void checkLogin();
                  }}
                >
                  Test key
                </button>
              </div>
              {check?.pending ? <p role="status">Checking...</p> : null}
              {check?.error ? (
                <p className="form-error" role="alert">
                  {check.error}
                </p>
              ) : null}
              {check?.result ? <CheckResult provider={providerId} result={check.result} /> : null}
            </>
          ) : null}
        </>
      ) : null}
      <Field name="labels" label="Labels" help="Comma separated.">
        <input
          className="field"
          value={labels}
          onChange={(e) => {
            setLabels(e.target.value);
          }}
        />
      </Field>
      <Field name="budget" label="Daily token budget" help="Blank means no budget.">
        <input
          className="field"
          inputMode="numeric"
          value={budget}
          onChange={(e) => {
            setBudget(e.target.value);
          }}
        />
      </Field>
      {type === 'api' ? (
        <Field
          name="costBudget"
          label="Daily cost budget (USD)"
          help="Blank means no budget. New runs stop when it is spent."
        >
          <input
            className="field"
            inputMode="decimal"
            value={costBudget}
            onChange={(e) => {
              setCostBudget(e.target.value);
            }}
          />
        </Field>
      ) : null}
      {type === 'cli' && isCliHarness && hasLimitWindows ? (
        <>
          <Field name="stop5h" label="Stop new work at (5h %)" help="Keeps a reserve for your own use.">
            <input
              className="field"
              inputMode="numeric"
              value={stop5h}
              onChange={(e) => {
                setStop5h(e.target.value);
              }}
            />
          </Field>
          <Field name="stopWeek" label="Stop new work at (weekly %)" help="Keeps a reserve for your own use.">
            <input
              className="field"
              inputMode="numeric"
              value={stopWeek}
              onChange={(e) => {
                setStopWeek(e.target.value);
              }}
            />
          </Field>
        </>
      ) : null}
      <Field name="concurrent" label="Max concurrent runs">
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

function CheckResult({ provider, result }: { provider: string; result: ProbeResult }) {
  if (result.loggedIn) {
    const plan = planLabel(provider, result.identity.plan);
    return (
      <p role="status">
        {[`Logged in`, result.identity.email, plan].filter(Boolean).join(' - ')}
        {result.note ? <span className="dim">{` ${result.note}`}</span> : null}
      </p>
    );
  }
  return (
    <div role="status">
      <p>{result.error ?? 'Not logged in. Run this in a terminal, then check again:'}</p>
      {result.loginCommand ? (
        <div className="panel-row">
          <code className="mono-wrap">{result.loginCommand}</code>
          <button
            type="button"
            className="btn"
            onClick={() => {
              copyText(result.loginCommand ?? '');
            }}
          >
            Copy command
          </button>
        </div>
      ) : null}
    </div>
  );
}
