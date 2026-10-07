import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AccountDto,
  LoginResult,
  UsageDetails,
  ProbeResult,
  RefreshLimitsResult,
} from '@agent-band/contracts';
import { expandHome, type AccountUseCases, type ConnectionUpdate } from './modules/accounts/index.ts';
import type { ActorContext } from './platform/actor.ts';
import type { Db } from './platform/db.ts';
import { invalid } from './platform/errors.ts';
import type { Authorizer } from './ports/index.ts';
import {
  defaultConfigDir,
  probeAccount,
  probeApiKey,
  readClaudeUsage,
  readCodexUsage,
  readLatestCodexRateLimits,
  startLogin,
  type CliBins,
  type CliProvider,
  type LimitReading,
} from './runner/index.ts';
import type { createUsage } from './modules/usage/index.ts';

const CONNECTION_INTERVAL_MS = 30 * 60_000;
const LIMITS_INTERVAL_MS = 5 * 60_000;

export interface AccountConnectionDeps {
  db: Db;
  accounts: AccountUseCases;
  usage: ReturnType<typeof createUsage>;
  authorizer: Authorizer;
  /** System actor that records probe results. */
  system: ActorContext;
  bins?: CliBins;
  loginTimeoutMs?: number;
  openUrl?: (url: string) => void;
  log?: (message: string, err?: unknown) => void;
}

function cliProvider(provider: string, type: string, allowApi = false): CliProvider {
  if ((provider !== 'claude' && provider !== 'openai') || (type !== 'cli' && !(allowApi && type === 'api'))) {
    throw invalid([
      { path: 'provider', message: 'login checks are only available for Claude and Codex cli accounts' },
    ]);
  }
  return provider;
}

function update(result: ProbeResult): ConnectionUpdate {
  const { email, orgName, plan, authMethod } = result.identity;
  return {
    loggedIn: result.loggedIn,
    plan: plan ?? null,
    email: email ?? null,
    orgName: orgName ?? null,
    authMethod: authMethod ?? null,
    checkedAt: result.checkedAt,
    identity: result.loggedIn && email ? (orgName ? `${email} (${orgName})` : email) : null,
  };
}

/** Login checks and limit refreshes that call the provider CLIs, kept out of the account module. */
export function createAccountConnection(deps: AccountConnectionDeps) {
  const { db, accounts, usage, system } = deps;
  const logins = new Map<string, Promise<void>>();

  async function manage(actor: ActorContext) {
    await deps.authorizer.authorize(db, actor, 'read', {});
    await deps.authorizer.authorize(db, actor, 'org.manage', {});
  }

  async function probeAndRecord(account: AccountDto, by?: string): Promise<ProbeResult> {
    const provider = cliProvider(account.provider, account.type, true);
    const bins = { ...(deps.bins && { bins: deps.bins }) };
    let result: ProbeResult;
    if (account.type === 'api') {
      const run = await accounts.getAccountForRun(db, account.orgId, account.id);
      if (!run.secret || !account.configDir) {
        result = {
          loggedIn: false,
          identity: {},
          checkedAt: new Date().toISOString(),
          error: 'no API key stored',
          loginCommand: null,
        };
      } else {
        result = await probeApiKey({ provider, configDir: account.configDir, apiKey: run.secret }, bins);
      }
    } else {
      result = await probeAccount({ provider, configDir: account.configDir }, bins);
    }
    await accounts.recordConnection(db, system, account.id, update(result), by);
    return result;
  }

  async function readLimits(account: AccountDto): Promise<RefreshLimitsResult> {
    if (account.type === 'api') return { windows: [], updatedAt: null, error: null, details: null };
    const provider = cliProvider(account.provider, account.type);
    const opts = { ...(deps.bins && { bins: deps.bins }) };
    const known = async (error: string | null): Promise<RefreshLimitsResult> => ({
      windows: await usage.latestWindows(db, system, account.id),
      updatedAt: (await usage.snapshotsUpdatedAt(db, system, account.id))?.toISOString() ?? null,
      error,
      details: account.connection?.usageDetails ?? null,
    });
    try {
      let reading: LimitReading;
      if (provider === 'claude') reading = await readClaudeUsage({ configDir: account.configDir }, opts);
      else {
        try {
          reading = await readCodexUsage({ configDir: account.configDir }, opts);
        } catch (err) {
          // Older Codex without app-server: fall back to the newest local rollout.
          const event = await readLatestCodexRateLimits(account.configDir ?? defaultConfigDir('openai'));
          if (event?.kind !== 'rate_limit' || event.windows.length === 0) throw err;
          reading = { windows: event.windows, perModel: [] };
        }
      }
      if (reading.windows.length > 0) {
        await db.transaction((tx) => usage.recordWindows(tx, system, account.id, reading.windows));
      }
      const details: UsageDetails = {
        perModel: reading.perModel,
        credits: reading.codex?.credits ?? null,
        ordinaryUsageAllowed: reading.codex?.ordinaryUsageAllowed ?? null,
        limitReached: reading.codex?.limitReached ?? reading.windows.some((w) => w.usedPercent >= 100),
        daily: reading.codex?.daily ?? [],
      };
      await accounts.recordUsageDetails(db, system, account.id, details);
      return { ...(await known(null)), details };
    } catch (err) {
      return known(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    async probe(actor: ActorContext, id: string): Promise<ProbeResult> {
      await manage(actor);
      return probeAndRecord(await accounts.getAccount(db, actor, id), actor.principalId);
    },

    async probeConfig(
      actor: ActorContext,
      body: { provider: string; type: string; configDir?: string | undefined; secret?: string | undefined },
    ): Promise<ProbeResult> {
      await manage(actor);
      const provider = cliProvider(body.provider, body.type, true);
      if (body.type === 'api') {
        if (!body.secret) throw invalid([{ path: 'secret', message: 'enter the API key to test' }]);
        const temp = await mkdtemp(join(tmpdir(), 'ab-key-test-'));
        try {
          return await probeApiKey(
            { provider, configDir: temp, apiKey: body.secret },
            { ...(deps.bins && { bins: deps.bins }) },
          );
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
      }
      const dir = body.configDir === undefined ? null : expandHome(body.configDir);
      if (dir !== null && !dir.startsWith('/')) {
        throw invalid([{ path: 'configDir', message: 'must be an absolute path' }]);
      }
      return probeAccount({ provider, configDir: dir }, { ...(deps.bins && { bins: deps.bins }) });
    },

    /** Starts the provider's own browser login for this account; credentials never pass through us. */
    async login(actor: ActorContext, id: string, mode?: 'console'): Promise<LoginResult> {
      await manage(actor);
      const account = await accounts.getAccount(db, actor, id);
      const provider = cliProvider(account.provider, account.type);
      const handle = await startLogin(
        { provider, configDir: account.configDir, ...(mode && { mode }) },
        {
          ...(deps.bins && { bins: deps.bins }),
          ...(deps.loginTimeoutMs !== undefined && { timeoutMs: deps.loginTimeoutMs }),
          ...(deps.openUrl && { openUrl: deps.openUrl }),
        },
      );
      if (!handle.started) {
        return { started: false, command: handle.command, ...(handle.error && { error: handle.error }) };
      }
      if (!logins.has(id)) {
        const finished = handle.done
          .then(() => probeAndRecord(account, actor.principalId))
          .then(
            () => undefined,
            (err: unknown) => deps.log?.(`probe after login failed for account ${id}`, err),
          )
          .finally(() => logins.delete(id));
        logins.set(id, finished);
      }
      return {
        started: true,
        command: handle.command,
        ...(handle.authUrl && { authUrl: handle.authUrl }),
      };
    },

    /** Resolves when a login started for this account has ended and been probed (tests). */
    loginSettled: (id: string): Promise<void> => logins.get(id) ?? Promise.resolve(),

    async refreshLimits(actor: ActorContext, id: string): Promise<RefreshLimitsResult> {
      await manage(actor);
      return readLimits(await accounts.getAccount(db, actor, id));
    },

    /** For the dispatcher: refresh without a user actor. */
    async refreshLimitsFor(id: string): Promise<void> {
      await readLimits(await accounts.getAccount(db, system, id));
    },

    /** Cheap login check for every cli account; no tokens are spent. */
    async probeAll(): Promise<void> {
      const list = await accounts.listAccounts(db, system, { type: 'cli' });
      for (const account of list) {
        if (account.provider !== 'claude' && account.provider !== 'openai') continue;
        try {
          await probeAndRecord(account);
        } catch (err) {
          deps.log?.(`connection probe failed for account ${account.id}`, err);
        }
      }
    },

    /** Free refresh of the limit windows of every logged-in cli account. */
    async refreshAllLimits(): Promise<void> {
      const list = await accounts.listAccounts(db, system, { type: 'cli' });
      for (const account of list) {
        if (account.provider !== 'claude' && account.provider !== 'openai') continue;
        if (account.connection?.loggedIn !== true) continue;
        try {
          await readLimits(account);
        } catch (err) {
          deps.log?.(`limit refresh failed for account ${account.id}`, err);
        }
      }
    },

    startBackground(): { stop: () => void } {
      const connections = () => {
        void this.probeAll().then(() => this.refreshAllLimits());
      };
      const limits = () => {
        void this.refreshAllLimits();
      };
      connections();
      const t1 = setInterval(connections, CONNECTION_INTERVAL_MS);
      const t2 = setInterval(limits, LIMITS_INTERVAL_MS);
      t1.unref();
      t2.unref();
      return {
        stop: () => {
          clearInterval(t1);
          clearInterval(t2);
        },
      };
    },
  };
}

export type AccountConnection = ReturnType<typeof createAccountConnection>;
