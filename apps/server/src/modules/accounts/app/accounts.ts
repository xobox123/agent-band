import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, forbidden, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx } from '../../../platform/tx.ts';
import type { DbOrTx, ModuleDeps } from '../../../ports/index.ts';
import {
  createAccountSchema,
  parseInput,
  updateAccountSchema,
  type CreateAccountInput,
  type UpdateAccountInput,
} from '../domain/account.ts';
import { validateProviderConfig, type AccountType } from '../domain/providers.ts';
import { accounts } from '../infra/schema.ts';
import { decryptSecret, encryptSecret, type SecretKeySource } from '../infra/secrets.ts';

import { ProviderId, type AccountDto } from '@agent-band/contracts';
export type { AccountDto } from '@agent-band/contracts';

export interface AccountForRun {
  id: string;
  orgId: string;
  provider: string;
  type: AccountType;
  providerConfig: Record<string, unknown>;
  configDir: string | null;
  providerIdentity: string | null;
  limits: AccountDto['limits'];
  secret: string | null;
}

export interface AccountsDeps extends ModuleDeps {
  secretKey: SecretKeySource;
  /** AGENT_BAND_HOME; managed account login directories live under it. */
  home: string;
  /** Provided by the agents module; used to refuse deleting an account that agents still use. */
  accountHasAgents: (db: DbOrTx, orgId: string, accountId: string) => Promise<boolean>;
}

type Row = typeof accounts.$inferSelect;

function toDto(r: Row): AccountDto {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    provider: ProviderId.parse(r.provider),
    type: r.type as AccountType,
    providerConfig: r.providerConfig as Record<string, unknown>,
    configDir: r.configDir,
    labels: r.labels,
    limits: r.limits as AccountDto['limits'],
    providerIdentity: r.providerIdentity,
    connection: (r.connection as AccountDto['connection']) ?? null,
    hasSecret: r.secretEnc !== null,
    secretUpdatedAt: r.secretUpdatedAt?.toISOString() ?? null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface ConnectionUpdate {
  loggedIn: boolean;
  plan: string | null;
  email: string | null;
  orgName: string | null;
  authMethod: string | null;
  checkedAt: string;
  /** Stable identity (email and org) when the CLI exposed it. */
  identity: string | null;
}

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'account';

function checkConfig(provider: string, type: AccountType, config: unknown): Record<string, unknown> {
  const check = validateProviderConfig(provider, type, config);
  if (!check.ok) throw invalid(check.issues);
  return check.providerConfig;
}

function checkSecretAllowed(type: AccountType, hasSecret: boolean): void {
  if (hasSecret && type !== 'api') {
    throw invalid([{ path: 'secret', message: 'secrets are only accepted for api accounts' }]);
  }
}

function checkConfigDirAllowed(type: AccountType, dir: unknown): void {
  if (dir && type !== 'cli') {
    throw invalid([{ path: 'configDir', message: 'configDir is only accepted for cli accounts' }]);
  }
}

export function createAccountUseCases(deps: AccountsDeps) {
  async function load(db: DbOrTx, orgId: string, id: string): Promise<Row> {
    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.id, id)));
    const row = rows[0];
    if (!row) throw notFound('Account');
    return row;
  }

  async function createAccount(db: Db, actor: ActorContext, input: CreateAccountInput): Promise<AccountDto> {
    await deps.authorizer.authorize(db, actor, 'org.manage', {});
    const v = parseInput(createAccountSchema, input);
    const providerConfig = checkConfig(v.provider, v.type, v.providerConfig);
    checkSecretAllowed(v.type, v.secret !== undefined);
    checkConfigDirAllowed(v.type, v.configDir);
    const cliHarness = v.provider === 'claude' || v.provider === 'openai';
    // API-key accounts of the CLI harnesses get their own private home so they never touch a stored login.
    const managed = v.managedConfigDir === true || (v.type === 'api' && cliHarness);
    if (v.managedConfigDir) {
      if (v.type !== 'cli' || v.configDir) {
        throw invalid([
          { path: 'managedConfigDir', message: 'only for cli accounts, and not together with configDir' },
        ]);
      }
    }

    return withTx(db, async (tx) => {
      const id = crypto.randomUUID();
      let configDir = v.configDir ?? null;
      if (managed) {
        const base = join(deps.home, 'accounts');
        const wanted = `${v.provider}-${slugOf(v.name)}`;
        configDir = join(base, existsSync(join(base, wanted)) ? `${wanted}-${id.slice(0, 6)}` : wanted);
        mkdirSync(configDir, { recursive: true, mode: 0o700 });
      }
      const now = new Date();
      const [row] = await tx
        .insert(accounts)
        .values({
          id,
          orgId: actor.orgId,
          name: v.name,
          provider: v.provider,
          type: v.type,
          providerConfig,
          configDir,
          secretEnc: v.secret === undefined ? null : encryptSecret(deps.secretKey(), v.secret, id),
          secretUpdatedAt: v.secret === undefined ? null : now,
          labels: v.labels,
          limits: v.limits,
          createdBy: actor.principalId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('account insert returned no row');
      const dto = toDto(row);
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'account.created',
        targetType: 'account',
        targetId: id,
        data: {
          name: dto.name,
          provider: dto.provider,
          type: dto.type,
          hasSecret: dto.hasSecret,
          managedConfigDir: managed,
        },
      });
      await publish(tx, 'account.created', { orgId: actor.orgId, accountId: id });
      return dto;
    });
  }

  async function updateAccount(
    db: Db,
    actor: ActorContext,
    id: string,
    input: UpdateAccountInput,
  ): Promise<AccountDto> {
    await deps.authorizer.authorize(db, actor, 'org.manage', {});
    const v = parseInput(updateAccountSchema, input);
    const current = await load(db, actor.orgId, id);
    const type = current.type as AccountType;
    checkSecretAllowed(type, v.secret !== undefined);
    checkConfigDirAllowed(type, v.configDir);
    const providerConfig =
      v.providerConfig === undefined ? undefined : checkConfig(current.provider, type, v.providerConfig);

    return withTx(db, async (tx) => {
      const now = new Date();
      const [row] = await tx
        .update(accounts)
        .set({
          ...(v.name !== undefined && { name: v.name }),
          ...(providerConfig !== undefined && { providerConfig }),
          ...(v.configDir !== undefined && { configDir: v.configDir }),
          ...(v.labels !== undefined && { labels: v.labels }),
          ...(v.limits !== undefined && { limits: v.limits }),
          ...(v.secret !== undefined && {
            secretEnc: encryptSecret(deps.secretKey(), v.secret, id),
            secretUpdatedAt: now,
          }),
          updatedAt: now,
        })
        .where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, id)))
        .returning();
      if (!row) throw notFound('Account');
      const changed = Object.keys(v).filter((k) => k !== 'secret');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'account.updated',
        targetType: 'account',
        targetId: id,
        data: { changed, secretReplaced: v.secret !== undefined },
      });
      await publish(tx, 'account.updated', { orgId: actor.orgId, accountId: id });
      return toDto(row);
    });
  }

  /** Records the signed-in provider identity (email/org/workspace); accounts sharing one share usage counters. */
  async function setAccountProviderIdentity(
    db: Db,
    actor: ActorContext,
    id: string,
    identity: string | null,
  ): Promise<AccountDto> {
    await deps.authorizer.authorize(db, actor, 'org.manage', {});
    const value = identity === null ? null : identity.trim();
    if (value !== null && (value.length === 0 || value.length > 320)) {
      throw invalid([{ path: 'providerIdentity', message: 'must be 1-320 characters' }]);
    }
    await load(db, actor.orgId, id);
    return withTx(db, async (tx) => {
      const [row] = await tx
        .update(accounts)
        .set({ providerIdentity: value, updatedAt: new Date() })
        .where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, id)))
        .returning();
      if (!row) throw notFound('Account');
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'account.identity_set',
        targetType: 'account',
        targetId: id,
        data: { providerIdentity: value },
      });
      await publish(tx, 'account.updated', { orgId: actor.orgId, accountId: id });
      return toDto(row);
    });
  }

  /** System use only (after a CLI probe): stores the connection state and, when it changes, the identity. */
  async function recordConnection(
    db: Db,
    actor: ActorContext,
    id: string,
    update: ConnectionUpdate,
    onBehalfOf?: string,
  ): Promise<AccountDto> {
    if (actor.kind !== 'system') throw forbidden('System actor required');
    await deps.authorizer.authorize(db, actor, 'read', {});
    const current = await load(db, actor.orgId, id);
    return withTx(db, async (tx) => {
      const identityChanged = update.identity !== null && update.identity !== current.providerIdentity;
      const [row] = await tx
        .update(accounts)
        .set({
          connection: {
            loggedIn: update.loggedIn,
            plan: update.plan,
            email: update.email,
            orgName: update.orgName,
            authMethod: update.authMethod,
            checkedAt: update.checkedAt,
            usageDetails: (current.connection as { usageDetails?: unknown } | null)?.usageDetails ?? null,
          },
          ...(identityChanged && { providerIdentity: update.identity }),
        })
        .where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, id)))
        .returning();
      if (!row) throw notFound('Account');
      if (identityChanged) {
        await deps.audit.append(tx, {
          orgId: actor.orgId,
          actorId: onBehalfOf ?? actor.principalId,
          action: 'account.identity_set',
          targetType: 'account',
          targetId: id,
          data: { providerIdentity: update.identity, source: 'probe' },
        });
      }
      await publish(tx, 'account.updated', { orgId: actor.orgId, accountId: id });
      return toDto(row);
    });
  }

  /** System use only: stores the provider-specific usage extras next to the connection state. */
  async function recordUsageDetails(
    db: Db,
    actor: ActorContext,
    id: string,
    details: unknown,
  ): Promise<void> {
    if (actor.kind !== 'system') throw forbidden('System actor required');
    const current = await load(db, actor.orgId, id);
    if (!current.connection) return;
    await db
      .update(accounts)
      .set({ connection: { ...current.connection, usageDetails: details } })
      .where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, id)));
  }

  async function deleteAccount(db: Db, actor: ActorContext, id: string): Promise<void> {
    await deps.authorizer.authorize(db, actor, 'org.manage', {});
    const current = await load(db, actor.orgId, id);
    await withTx(db, async (tx) => {
      if (await deps.accountHasAgents(tx, actor.orgId, id)) {
        throw conflict('account_in_use', 'Account is used by agents');
      }
      await tx.delete(accounts).where(and(eq(accounts.orgId, actor.orgId), eq(accounts.id, id)));
      await deps.audit.append(tx, {
        orgId: actor.orgId,
        actorId: actor.principalId,
        action: 'account.deleted',
        targetType: 'account',
        targetId: id,
        data: { name: current.name },
      });
      await publish(tx, 'account.deleted', { orgId: actor.orgId, accountId: id });
    });
  }

  async function listAccounts(
    db: Db,
    actor: ActorContext,
    filter: { provider?: string; type?: AccountType; label?: string } = {},
  ): Promise<AccountDto[]> {
    await deps.authorizer.authorize(db, actor, 'read', {});
    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.orgId, actor.orgId))
      .orderBy(accounts.createdAt);
    return rows
      .filter(
        (r) =>
          (!filter.provider || r.provider === filter.provider) &&
          (!filter.type || r.type === filter.type) &&
          (!filter.label || r.labels.includes(filter.label)),
      )
      .map(toDto);
  }

  async function getAccount(db: Db, actor: ActorContext, id: string): Promise<AccountDto> {
    await deps.authorizer.authorize(db, actor, 'read', {});
    return toDto(await load(db, actor.orgId, id));
  }

  /** Internal, for the worker only: returns the decrypted secret. Never expose over HTTP. */
  async function getAccountForRun(db: DbOrTx, orgId: string, id: string): Promise<AccountForRun> {
    const r = await load(db, orgId, id);
    return {
      id: r.id,
      orgId: r.orgId,
      provider: ProviderId.parse(r.provider),
      type: r.type as AccountType,
      providerConfig: r.providerConfig as Record<string, unknown>,
      configDir: r.configDir,
      providerIdentity: r.providerIdentity,
      limits: r.limits as AccountDto['limits'],
      secret: r.secretEnc === null ? null : decryptSecret(deps.secretKey(), r.secretEnc, r.id),
    };
  }

  async function accountExists(db: DbOrTx, orgId: string, id: string): Promise<boolean> {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.id, id)));
    return rows.length > 0;
  }

  return {
    createAccount,
    updateAccount,
    setAccountProviderIdentity,
    recordConnection,
    recordUsageDetails,
    deleteAccount,
    listAccounts,
    getAccount,
    getAccountForRun,
    accountExists,
  };
}

export type AccountUseCases = ReturnType<typeof createAccountUseCases>;
