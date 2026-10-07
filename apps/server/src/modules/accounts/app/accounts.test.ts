import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { AppError } from '../../../platform/errors.ts';
import { outboxEvents } from '../../../platform/schema.ts';
import { fakeDeps, testActor } from '../../../ports/testing.ts';
import { fixedKeySource } from '../infra/secrets.ts';
import { accounts } from '../infra/schema.ts';
import { createAccountUseCases } from './accounts.ts';

let database: Database;
beforeEach(async () => {
  database = await openTestDatabase();
});
afterEach(async () => {
  await database.close();
});

function setup(hasAgents = false) {
  const deps = fakeDeps();
  const uc = createAccountUseCases({
    ...deps,
    secretKey: fixedKeySource(randomBytes(32)),
    home: tmpdir(),
    accountHasAgents: () => Promise.resolve(hasAgents),
  });
  return { deps, uc, actor: testActor(), db: database.db };
}

const code = async (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => (e instanceof AppError ? e.code : 'other'),
  );

describe('accounts', () => {
  it('writes no audit rows for list and get', async () => {
    const { deps, uc, actor, db } = setup();
    const dto = await uc.createAccount(db, actor, {
      name: 'API',
      provider: 'claude',
      type: 'api',
      secret: 's',
    });
    deps.audit.entries.length = 0;
    await uc.getAccount(db, actor, dto.id);
    await uc.listAccounts(db, actor);
    expect(deps.audit.entries).toEqual([]);
  });

  it('never exposes the secret and reports hasSecret', async () => {
    const { uc, actor, db } = setup();
    const dto = await uc.createAccount(db, actor, {
      name: 'API',
      provider: 'claude',
      type: 'api',
      secret: 'sk-very-secret',
    });
    expect(dto.hasSecret).toBe(true);
    expect(dto.secretUpdatedAt).not.toBeNull();
    const fetched = [await uc.getAccount(db, actor, dto.id), ...(await uc.listAccounts(db, actor))];
    for (const d of fetched) expect(JSON.stringify(d)).not.toContain('sk-very-secret');
    expect(JSON.stringify(dto)).not.toMatch(/secretEnc|"secret"/);
    const raw = await db.select().from(accounts).where(eq(accounts.id, dto.id));
    expect(raw[0]?.secretEnc).toBeTruthy();
    expect(raw[0]?.secretEnc).not.toContain('sk-very-secret');
  });

  it('getAccountForRun returns the decrypted secret and replacement updates it', async () => {
    const { uc, actor, db } = setup();
    const dto = await uc.createAccount(db, actor, {
      name: 'A',
      provider: 'openai',
      type: 'api',
      secret: 'one',
    });
    expect((await uc.getAccountForRun(db, actor.orgId, dto.id)).secret).toBe('one');
    await uc.updateAccount(db, actor, dto.id, { secret: 'two' });
    expect((await uc.getAccountForRun(db, actor.orgId, dto.id)).secret).toBe('two');
    const cli = await uc.createAccount(db, actor, { name: 'C', provider: 'claude', type: 'cli' });
    expect(cli.hasSecret).toBe(false);
    expect((await uc.getAccountForRun(db, actor.orgId, cli.id)).secret).toBeNull();
  });

  it('rejects a tampered stored secret', async () => {
    const { uc, actor, db } = setup();
    const dto = await uc.createAccount(db, actor, {
      name: 'A',
      provider: 'claude',
      type: 'api',
      secret: 'one',
    });
    const other = await uc.createAccount(db, actor, {
      name: 'B',
      provider: 'claude',
      type: 'api',
      secret: 'two',
    });
    const row = (await db.select().from(accounts).where(eq(accounts.id, other.id)))[0];
    await db
      .update(accounts)
      .set({ secretEnc: row?.secretEnc ?? null })
      .where(eq(accounts.id, dto.id));
    await expect(uc.getAccountForRun(db, actor.orgId, dto.id)).rejects.toThrow();
  });

  it('validates provider and providerConfig', async () => {
    const { uc, actor, db } = setup();
    expect(await code(uc.createAccount(db, actor, { name: 'X', provider: 'nope', type: 'cli' }))).toBe(
      'validation_failed',
    );
    expect(
      await code(uc.createAccount(db, actor, { name: 'X', provider: 'openai_compatible', type: 'api' })),
    ).toBe('validation_failed');
    const ok = await uc.createAccount(db, actor, {
      name: 'Local',
      provider: 'openai_compatible',
      type: 'api',
      providerConfig: { baseUrl: 'http://localhost:11434/v1', models: ['llama3'] },
    });
    expect(ok.providerConfig).toMatchObject({ baseUrl: 'http://localhost:11434/v1', wireApi: 'chat' });
    expect(ok.hasSecret).toBe(false);
  });

  it('rejects secrets on cli accounts, configDir on api accounts and bad paths', async () => {
    const { uc, actor, db } = setup();
    const base = { name: 'X', provider: 'claude' };
    expect(await code(uc.createAccount(db, actor, { ...base, type: 'cli', secret: 's' }))).toBe(
      'validation_failed',
    );
    expect(await code(uc.createAccount(db, actor, { ...base, type: 'api', configDir: '/tmp/x' }))).toBe(
      'validation_failed',
    );
    expect(await code(uc.createAccount(db, actor, { ...base, type: 'cli', configDir: 'rel/path' }))).toBe(
      'validation_failed',
    );
    expect(await code(uc.createAccount(db, actor, { ...base, type: 'cli', configDir: '/a/../b' }))).toBe(
      'validation_failed',
    );
    const ok = await uc.createAccount(db, actor, { ...base, type: 'cli', configDir: '/home/me/.claude-a' });
    expect(ok.configDir).toBe('/home/me/.claude-a');
  });

  it('sets provider identity', async () => {
    const { uc, actor, db } = setup();
    const a = await uc.createAccount(db, actor, { name: 'A', provider: 'claude', type: 'cli' });
    expect(a.providerIdentity).toBeNull();
    const b = await uc.setAccountProviderIdentity(db, actor, a.id, ' me@example.com ');
    expect(b.providerIdentity).toBe('me@example.com');
    expect((await uc.setAccountProviderIdentity(db, actor, a.id, null)).providerIdentity).toBeNull();
  });

  it('deleting an account used by agents conflicts; otherwise deletes', async () => {
    const used = setup(true);
    const a = await used.uc.createAccount(used.db, used.actor, {
      name: 'A',
      provider: 'claude',
      type: 'cli',
    });
    expect(await code(used.uc.deleteAccount(used.db, used.actor, a.id))).toBe('account_in_use');
    expect((await used.uc.getAccount(used.db, used.actor, a.id)).id).toBe(a.id);

    const free = setup(false);
    const b = await free.uc.createAccount(free.db, free.actor, {
      name: 'B',
      provider: 'claude',
      type: 'cli',
    });
    await free.uc.deleteAccount(free.db, free.actor, b.id);
    expect(await code(free.uc.getAccount(free.db, free.actor, b.id))).toBe('not_found');
  });

  it('scopes by org', async () => {
    const { uc, actor, db } = setup();
    const a = await uc.createAccount(db, actor, { name: 'A', provider: 'claude', type: 'cli' });
    const stranger = testActor();
    expect(await code(uc.getAccount(db, stranger, a.id))).toBe('not_found');
    expect(await uc.listAccounts(db, stranger)).toEqual([]);
  });

  it('authorizes org.manage for writes and read for reads, audits and publishes', async () => {
    const { uc, actor, db, deps } = setup();
    const a = await uc.createAccount(db, actor, { name: 'A', provider: 'claude', type: 'cli' });
    await uc.updateAccount(db, actor, a.id, { labels: ['team'] });
    await uc.listAccounts(db, actor);
    expect(deps.authorizer.checks.map((c) => c.action)).toEqual(['org.manage', 'org.manage', 'read']);
    expect(deps.audit.entries.map((e) => e.action)).toEqual(['account.created', 'account.updated']);

    deps.authorizer.deny = (action) => action === 'org.manage';
    expect(await code(uc.createAccount(db, actor, { name: 'B', provider: 'claude', type: 'cli' }))).toBe(
      'forbidden',
    );
    expect(await code(uc.deleteAccount(db, actor, a.id))).toBe('forbidden');
    expect(deps.audit.entries).toHaveLength(2);

    const events = await db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.type} like 'account.%'`);
    expect(events.map((e) => e.type)).toEqual(['account.created', 'account.updated']);
  });

  it('never writes the secret to audit data or events', async () => {
    const { uc, actor, db, deps } = setup();
    const a = await uc.createAccount(db, actor, {
      name: 'A',
      provider: 'claude',
      type: 'api',
      secret: 'topsecret',
    });
    await uc.updateAccount(db, actor, a.id, { secret: 'topsecret2' });
    const events = await db.select().from(outboxEvents);
    expect(JSON.stringify(deps.audit.entries) + JSON.stringify(events)).not.toContain('topsecret');
  });
});
