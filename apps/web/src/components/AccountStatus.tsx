import type { AccountDto, LimitWindowDto } from '@agent-band/contracts';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client.ts';
import { useApi } from '../api/context.tsx';
import { useNow } from '../hooks/useNow.ts';
import { ago, isStale, planLabel, resetsIn } from '../lib/account.ts';
import { copyText, formatCost, formatTime } from '../lib/format.ts';
import { LimitBar } from './LimitBar.tsx';

/** Google quota is per model and per day and has no free headless reading, so no bars are drawn. */
const GEMINI_QUOTA_NOTE = 'Google quota: see /stats in Gemini';

/** Logged-in dot, email, organization, plan, auth method and the time of the last check. */
export function AccountIdentity({ account }: { account: AccountDto }) {
  const now = useNow();
  const c = account.connection;
  if (!c) return <p className="dim">Login not checked yet.</p>;
  const plan = planLabel(account.provider, c.plan);
  return (
    <dl className="kv" aria-label={`${account.name} identity`}>
      <dt>Login</dt>
      <dd>
        <span className="conn-dot" data-ok={String(c.loggedIn)} aria-hidden="true" />{' '}
        {c.loggedIn ? 'Logged in' : 'Not logged in'}
      </dd>
      {c.email ? (
        <>
          <dt>Email</dt>
          <dd>{c.email}</dd>
        </>
      ) : null}
      {c.orgName ? (
        <>
          <dt>Organization</dt>
          <dd>{c.orgName}</dd>
        </>
      ) : null}
      {plan ? (
        <>
          <dt>Plan</dt>
          <dd>{plan}</dd>
        </>
      ) : null}
      {c.authMethod ? (
        <>
          <dt>Auth method</dt>
          <dd>{c.authMethod}</dd>
        </>
      ) : null}
      <dt>Checked</dt>
      <dd title={formatTime(c.checkedAt)}>{ago(c.checkedAt, now)}</dd>
    </dl>
  );
}

interface LimitsProps {
  account: AccountDto;
  windows: LimitWindowDto[];
  updatedAt: string | null;
}

interface WindowBarProps {
  account: AccountDto;
  windows: LimitWindowDto[];
  window: '5h' | 'weekly';
  stale: boolean;
  now: number;
  compact?: boolean;
}

/** One limit window of an account; shared by the detail panel and the compact table cell. */
function WindowBar({ account, windows, window: w, stale, now, compact }: WindowBarProps) {
  const stopAt = account.limits.stopAt;
  const win = windows.find((x) => x.window === w);
  const reset = resetsIn(win?.resetsAt, now);
  const marker = w === '5h' ? stopAt?.fiveHourPercent : stopAt?.weeklyPercent;
  const tip = [
    w === '5h' ? '5h window' : 'Weekly window',
    win?.resetsAt ? `resets ${formatTime(win.resetsAt)}` : 'no reset info',
    marker === undefined ? null : `stops new work at ${String(marker)}%`,
    stale ? 'stale' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <LimitBar
      name={compact ? (w === '5h' ? '5h' : 'wk') : w === '5h' ? '5h window' : 'Weekly window'}
      value={win ? win.usedPercent : null}
      label={`${account.name} ${w}`}
      title={compact ? tip : win?.resetsAt ? `Resets ${formatTime(win.resetsAt)}` : undefined}
      marker={marker}
      stale={stale}
      reset={reset ? `resets ${reset}` : null}
      resetTitle={win?.resetsAt ? formatTime(win.resetsAt) : undefined}
      compact={compact}
    />
  );
}

/** The 5h and weekly bars with reset times, a stale dimming and the reserve markers. */
export function AccountLimits({ account, windows, updatedAt }: LimitsProps) {
  const now = useNow();
  const stale = isStale(updatedAt, now);
  if (account.provider === 'gemini') return <p className="dim">{GEMINI_QUOTA_NOTE}</p>;
  return (
    <>
      <div className="limit-rows">
        {(['5h', 'weekly'] as const).map((w) => (
          <WindowBar key={w} account={account} windows={windows} window={w} stale={stale} now={now} />
        ))}
      </div>
      <p className="dim limit-updated">
        {updatedAt ? `Updated ${ago(updatedAt, now)}` : 'Limits not read yet'}
        {stale && updatedAt ? <span> (stale)</span> : null}
      </p>
    </>
  );
}

/** Table cell: two stacked mini bars for subscriptions, spend against budget for API accounts. */
export function AccountLimitsCompact({
  account,
  windows,
  updatedAt,
  costToday,
}: LimitsProps & { costToday: number | null }) {
  const now = useNow();
  if (account.type === 'api') {
    const budget = account.limits.dailyCostBudgetUsd;
    const spent = costToday ?? 0;
    return (
      <span title={budget === undefined ? 'No daily cost budget' : `Daily cost budget $${String(budget)}`}>
        {budget === undefined ? formatCost(spent) : `${formatCost(spent)} / ${formatCost(budget)}`}
      </span>
    );
  }
  if (account.provider === 'gemini') {
    return (
      <span className="dim" title={GEMINI_QUOTA_NOTE}>
        see /stats in Gemini
      </span>
    );
  }
  const stale = isStale(updatedAt, now);
  return (
    <div className="limit-cell" aria-label={`${account.name} limits`}>
      {(['5h', 'weekly'] as const).map((w) => (
        <WindowBar key={w} account={account} windows={windows} window={w} stale={stale} now={now} compact />
      ))}
    </div>
  );
}

interface ActionsProps {
  account: AccountDto;
  onChanged: () => void;
  /** Refresh limits is only useful where windows exist. */
  showLimits?: boolean;
  /** Starts a login on mount (used right after creating a managed account). */
  autoLogin?: 'console' | 'subscription' | undefined;
}

/** "Check now", "Refresh limits" and "Log in" with the waiting state and the fallback command. */
export function AccountActions({ account, onChanged, showLimits = true, autoLogin }: ActionsProps) {
  const api = useApi();
  const [busy, setBusy] = useState<'probe' | 'limits' | 'login' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<{
    command: string;
    authUrl?: string | undefined;
    failed: boolean;
  } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const loggedIn = account.connection?.loggedIn === true;
  const isCli = account.type === 'cli';

  const run = async (kind: 'probe' | 'limits', fn: () => Promise<string | null>) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const startLogin = async (mode?: 'console') => {
    setBusy('login');
    setError(null);
    try {
      const res = await api.accounts.login(account.id, mode ? { mode } : undefined);
      setLogin({ command: res.command, authUrl: res.authUrl, failed: !res.started });
      setWaiting(res.started);
      if (!res.started && res.error) setError(res.error);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (autoLogin) void startLogin(autoLogin === 'console' ? 'console' : undefined);
  }, []);

  useEffect(() => {
    if (loggedIn && waiting) {
      setWaiting(false);
      setLogin(null);
    }
  }, [loggedIn, waiting]);

  return (
    <div className="account-actions">
      <div className="panel-row">
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => {
            void run('probe', async () => {
              const res = await api.accounts.probe(account.id);
              return res.error ?? (res.loggedIn ? 'Login is valid.' : 'Not logged in.');
            });
          }}
        >
          Check now
        </button>
        {showLimits && account.type === 'cli' && account.provider !== 'gemini' ? (
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => {
              void run('limits', async () => {
                const res = await api.accounts.refreshLimits(account.id);
                return res.error ? `Could not read limits: ${res.error}` : 'Limits updated.';
              });
            }}
          >
            Refresh limits
          </button>
        ) : null}
        {isCli && !loggedIn && !waiting ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => {
              void startLogin();
            }}
          >
            Log in
          </button>
        ) : null}
        {isCli && account.provider === 'claude' && !loggedIn && !waiting ? (
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => {
              void startLogin('console');
            }}
          >
            Log in to Anthropic Console
          </button>
        ) : null}
      </div>
      {waiting ? <p role="status">Waiting for login in your browser...</p> : null}
      {login ? (
        <div className="panel-row">
          {login.authUrl ? (
            <>
              <span className="mono-wrap">{login.authUrl}</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  copyText(login.authUrl ?? '');
                }}
              >
                Copy link
              </button>
              <a className="btn" href={login.authUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            </>
          ) : null}
          <span className="dim">
            {account.provider === 'gemini'
              ? 'Gemini signs in inside its own terminal UI. Run this in a terminal, choose "Sign in with Google", then type /quit and click Check now:'
              : account.provider === 'antigravity'
                ? 'Antigravity signs in inside its own terminal UI. Run this in a terminal, sign in with your Google account, then type /quit and click Check now:'
                : login.failed
                  ? 'Could not start the login. Run this in a terminal:'
                  : 'Or in a terminal:'}
          </span>
          <code className="mono-wrap">{login.command}</code>
          <button
            type="button"
            className="btn"
            onClick={() => {
              copyText(login.command);
            }}
          >
            Copy command
          </button>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Per-model weeks, Codex credits and limit flag, and a 30-day token chart (plain bars). */
export function UsageExtras({ account }: { account: AccountDto }) {
  const d = account.connection?.usageDetails;
  if (!d) return null;
  const max = Math.max(1, ...d.daily.map((x) => x.tokens));
  return (
    <div aria-label={`${account.name} usage details`}>
      {d.perModel.length > 0 ? (
        <div className="limit-rows">
          {d.perModel.map((m) => (
            <LimitBar
              key={m.label}
              name={`Week (${m.label})`}
              value={m.usedPercent}
              label={`${account.name} week ${m.label}`}
            />
          ))}
        </div>
      ) : null}
      {d.ordinaryUsageAllowed !== null ? (
        <div className="panel-row">
          <span>Ordinary usage</span>
          <span>{d.ordinaryUsageAllowed ? 'Allowed' : 'Not allowed'}</span>
          {d.limitReached ? <span className="badge badge-crit">Limit reached</span> : null}
        </div>
      ) : null}
      {d.credits ? (
        <div className="panel-row">
          <span>Credits</span>
          <span>
            {d.credits.unlimited
              ? 'Unlimited'
              : d.credits.hasCredits
                ? `Balance ${d.credits.balance ?? '?'}`
                : 'None'}
          </span>
        </div>
      ) : null}
      {d.daily.length > 0 ? (
        <div>
          <span className="dim">Tokens per day, last 30 days</span>
          <div className="daily-bars" role="img" aria-label="Tokens per day">
            {d.daily.map((x) => (
              <span
                key={x.date}
                className="daily-bar"
                title={`${x.date}: ${String(x.tokens)} tokens`}
                style={{ height: `${String(Math.max(2, (x.tokens / max) * 100))}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
