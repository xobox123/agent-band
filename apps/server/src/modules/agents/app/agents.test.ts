import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { AppError, forbidden } from '../../../platform/errors.ts';
import { outboxEvents } from '../../../platform/schema.ts';
import type { Authorizer } from '../../../ports/index.ts';
import { fakeDeps, FakePrincipalRegistry, testActor } from '../../../ports/testing.ts';
import { createAccountUseCases, fixedKeySource } from '../../accounts/index.ts';
import { decide, type Binding } from '../../org/domain/rbac.ts';
import { accountHasAgents, createAgentUseCases } from './agents.ts';
import { createAgentMembership, createPolicyBindings } from './bindings.ts';
import { createGroupUseCases } from './groups.ts';
import { agents } from '../infra/schema.ts';

let database: Database;
beforeEach(async () => {
  database = await openTestDatabase();
});
afterEach(async () => {
  await database.close();
});

const code = async (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => (e instanceof AppError ? e.code : 'other'),
  );

function setup(authorizer?: Authorizer) {
  const deps = fakeDeps();
  const principals = new FakePrincipalRegistry();
  const accountUc = createAccountUseCases({
    ...deps,
    secretKey: fixedKeySource(randomBytes(32)),
    home: tmpdir(),
    accountHasAgents,
  });
  const shared = { ...deps, ...(authorizer ? { authorizer } : {}) };
  const agentUc = createAgentUseCases({
    ...shared,
    principals,
    accountExists: accountUc.accountExists,
  });
  const groupUc = createGroupUseCases(shared);
  return { deps, principals, accountUc, agentUc, groupUc, db: database.db, actor: testActor() };
}

async function withAccount(s: ReturnType<typeof setup>) {
  return s.accountUc.createAccount(s.db, s.actor, { name: 'acc', provider: 'claude', type: 'cli' });
}

describe('agents', () => {
  it('creates an agent with principal handle agent:<slug>, defaults and events', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const a = await s.agentUc.createAgent(s.db, s.actor, {
      slug: 'backend-1',
      name: 'Backend One',
      accountId: acc.id,
      labels: ['backend'],
    });
    expect(s.principals.created).toEqual([{ id: a.id, handle: 'agent:backend-1' }]);
    expect(a.handle).toBe('agent:backend-1');
    expect(a.role).toBe('worker');
    expect(a.enabled).toBe(true);
    expect(a.gitIdentity).toEqual({
      name: 'Backend One (agent-band)',
      email: 'backend-1@agents.agent-band.local',
    });
    expect(s.deps.audit.entries.at(-1)).toMatchObject({ action: 'agent.created', targetId: a.id });
    const events = await s.db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.type} like 'agent.%'`);
    expect(events.map((e) => e.type)).toEqual(['agent.created']);
  });

  it('rejects a duplicate slug with conflict and creates no second principal', async () => {
    const s = setup();
    const acc = await withAccount(s);
    await s.agentUc.createAgent(s.db, s.actor, { slug: 'dup', name: 'A', accountId: acc.id });
    expect(
      await code(s.agentUc.createAgent(s.db, s.actor, { slug: 'dup', name: 'B', accountId: acc.id })),
    ).toBe('slug_taken');
    expect(s.principals.created).toHaveLength(1);
  });

  it('validates slug, labels, account existence and group existence', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const bad = (extra: object) =>
      code(s.agentUc.createAgent(s.db, s.actor, { slug: 'ok', name: 'A', accountId: acc.id, ...extra }));
    expect(await bad({ slug: 'Bad_Slug' })).toBe('validation_failed');
    expect(await bad({ slug: '-x' })).toBe('validation_failed');
    expect(await bad({ labels: ['a', 'a'] })).toBe('validation_failed');
    expect(await bad({ gitIdentity: { name: 'n', email: 'nope' } })).toBe('validation_failed');
    expect(await bad({ accountId: randomUUID() })).toBe('validation_failed');
    expect(await bad({ groupIds: [randomUUID()] })).toBe('not_found');
  });

  it('updates fields, keeps slug immutable and validates a new account', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const a = await s.agentUc.createAgent(s.db, s.actor, { slug: 'u', name: 'U', accountId: acc.id });
    const u = await s.agentUc.updateAgent(s.db, s.actor, a.id, {
      name: 'U2',
      model: 'opus',
      enabled: false,
      labels: ['x'],
    });
    expect(u).toMatchObject({ name: 'U2', model: 'opus', enabled: false, labels: ['x'], slug: 'u' });
    expect(await code(s.agentUc.updateAgent(s.db, s.actor, a.id, { slug: 'new' } as never))).toBe(
      'validation_failed',
    );
    expect(await code(s.agentUc.updateAgent(s.db, s.actor, a.id, { accountId: randomUUID() }))).toBe(
      'validation_failed',
    );
    expect((await s.agentUc.updateAgent(s.db, s.actor, a.id, { model: null })).model).toBeNull();
  });

  it('soft deletes: hidden from reads, row and slug kept, account no longer blocked', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const a = await s.agentUc.createAgent(s.db, s.actor, { slug: 'gone', name: 'G', accountId: acc.id });
    expect(await code(s.accountUc.deleteAccount(s.db, s.actor, acc.id))).toBe('account_in_use');
    await s.agentUc.deleteAgent(s.db, s.actor, a.id);
    expect(await code(s.agentUc.getAgent(s.db, s.actor, a.id))).toBe('not_found');
    expect(await s.agentUc.listAgents(s.db, s.actor)).toEqual([]);
    const raw = (await s.db.select().from(agents).where(eq(agents.id, a.id)))[0];
    expect(raw?.deletedAt).toBeInstanceOf(Date);
    expect(raw?.enabled).toBe(false);
    expect(
      await code(s.agentUc.createAgent(s.db, s.actor, { slug: 'gone', name: 'G', accountId: acc.id })),
    ).toBe('slug_taken');
    await s.accountUc.deleteAccount(s.db, s.actor, acc.id);
  });

  it('writes no audit rows for list and get', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const a = await s.agentUc.createAgent(s.db, s.actor, { name: 'A1', slug: 'a1', accountId: acc.id });
    s.deps.audit.entries.length = 0;
    await s.agentUc.getAgent(s.db, s.actor, a.id);
    await s.agentUc.listAgents(s.db, s.actor);
    expect(s.deps.audit.entries).toEqual([]);
  });

  it('lists with label, group and enabled filters and scopes by org', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const g = await s.groupUc.createGroup(s.db, s.actor, { name: 'team' });
    const a1 = await s.agentUc.createAgent(s.db, s.actor, {
      slug: 'a1',
      name: 'A1',
      accountId: acc.id,
      labels: ['l1'],
      groupIds: [g.id],
    });
    await s.agentUc.createAgent(s.db, s.actor, { slug: 'a2', name: 'A2', accountId: acc.id, enabled: false });
    expect((await s.agentUc.listAgents(s.db, s.actor)).map((a) => a.slug)).toEqual(['a1', 'a2']);
    expect((await s.agentUc.listAgents(s.db, s.actor, { label: 'l1' })).map((a) => a.id)).toEqual([a1.id]);
    expect((await s.agentUc.listAgents(s.db, s.actor, { groupId: g.id })).map((a) => a.id)).toEqual([a1.id]);
    expect((await s.agentUc.listAgents(s.db, s.actor, { enabled: false })).map((a) => a.slug)).toEqual([
      'a2',
    ]);
    expect(await s.agentUc.listAgents(s.db, testActor())).toEqual([]);
    expect(await code(s.agentUc.getAgent(s.db, testActor(), a1.id))).toBe('not_found');
  });
});

describe('groups', () => {
  it('manages groups and membership, with audit and events', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const g = await s.groupUc.createGroup(s.db, s.actor, { name: 'ops', labels: ['x'] });
    expect(await code(s.groupUc.createGroup(s.db, s.actor, { name: 'ops' }))).toBe('group_name_taken');
    const a = await s.agentUc.createAgent(s.db, s.actor, { slug: 'm', name: 'M', accountId: acc.id });
    expect((await s.groupUc.addAgentToGroup(s.db, s.actor, g.id, a.id)).agentIds).toEqual([a.id]);
    await s.groupUc.addAgentToGroup(s.db, s.actor, g.id, a.id);
    expect((await s.agentUc.getAgent(s.db, s.actor, a.id)).groupIds).toEqual([g.id]);
    expect((await s.groupUc.listGroups(s.db, s.actor))[0]?.agentIds).toEqual([a.id]);
    expect((await s.groupUc.updateGroup(s.db, s.actor, g.id, { description: 'd' })).description).toBe('d');
    expect((await s.groupUc.removeAgentFromGroup(s.db, s.actor, g.id, a.id)).agentIds).toEqual([]);
    await s.groupUc.addAgentToGroup(s.db, s.actor, g.id, a.id);
    await s.groupUc.deleteGroup(s.db, s.actor, g.id);
    expect(await s.groupUc.listGroups(s.db, s.actor)).toEqual([]);
    expect((await s.agentUc.getAgent(s.db, s.actor, a.id)).groupIds).toEqual([]);
    const actions = s.deps.audit.entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'agent_group.created',
        'agent_group.member_added',
        'agent_group.member_removed',
        'agent_group.updated',
        'agent_group.deleted',
      ]),
    );
    const events = await s.db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.type} like 'agent_group.%'`);
    expect(events.length).toBeGreaterThanOrEqual(6);
  });
});

describe('authorization', () => {
  function rbac(bindings: Binding[]): Authorizer {
    return {
      authorize(_db, _actor, action, resource) {
        const d = decide(bindings, action, resource);
        return d.allow ? Promise.resolve() : Promise.reject(forbidden(d.reason));
      },
    };
  }

  it('operator with a group binding can read but not manage agents in that group', async () => {
    const admin = setup();
    const acc = await withAccount(admin);
    const g = await admin.groupUc.createGroup(admin.db, admin.actor, { name: 'g' });
    const a = await admin.agentUc.createAgent(admin.db, admin.actor, {
      slug: 'x',
      name: 'X',
      accountId: acc.id,
      groupIds: [g.id],
    });
    const outsider = await admin.agentUc.createAgent(admin.db, admin.actor, {
      slug: 'y',
      name: 'Y',
      accountId: acc.id,
    });

    const op = rbac([{ role: 'operator', scope: { agentGroupId: g.id } }]);
    const agentsUc = createAgentUseCases({
      ...fakeDeps(),
      authorizer: op,
      principals: new FakePrincipalRegistry(),
      accountExists: () => Promise.resolve(true),
    });
    const groupsUc = createGroupUseCases({ ...fakeDeps(), authorizer: op });
    const { db, actor } = admin;

    expect((await agentsUc.getAgent(db, actor, a.id)).id).toBe(a.id);
    expect((await agentsUc.listAgents(db, actor, { groupId: g.id })).map((x) => x.id)).toEqual([a.id]);
    expect(await code(agentsUc.listAgents(db, actor))).toBe('forbidden');
    expect(await code(agentsUc.getAgent(db, actor, outsider.id))).toBe('forbidden');
    expect(await code(agentsUc.updateAgent(db, actor, a.id, { name: 'N' }))).toBe('forbidden');
    expect(await code(agentsUc.deleteAgent(db, actor, a.id))).toBe('forbidden');
    expect(await code(groupsUc.updateGroup(db, actor, g.id, { description: 'x' }))).toBe('forbidden');
    expect(await code(groupsUc.createGroup(db, actor, { name: 'z' }))).toBe('forbidden');
  });

  it('group admin can manage agents in the group but cannot create org-level agents', async () => {
    const s0 = setup();
    const acc = await withAccount(s0);
    const g = await s0.groupUc.createGroup(s0.db, s0.actor, { name: 'g' });
    const adminOfGroup = rbac([{ role: 'admin', scope: { agentGroupId: g.id } }]);
    const uc = createAgentUseCases({
      ...fakeDeps(),
      authorizer: adminOfGroup,
      principals: new FakePrincipalRegistry(),
      accountExists: () => Promise.resolve(true),
    });
    const a = await uc.createAgent(s0.db, s0.actor, {
      slug: 'ga',
      name: 'GA',
      accountId: acc.id,
      groupIds: [g.id],
    });
    expect((await uc.updateAgent(s0.db, s0.actor, a.id, { name: 'GA2' })).name).toBe('GA2');
    expect(await code(uc.createAgent(s0.db, s0.actor, { slug: 'ng', name: 'NG', accountId: acc.id }))).toBe(
      'forbidden',
    );
  });

  it('passes agentId and group ids to the authorizer and denies write without writing', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const g = await s.groupUc.createGroup(s.db, s.actor, { name: 'g' });
    const a = await s.agentUc.createAgent(s.db, s.actor, {
      slug: 'p',
      name: 'P',
      accountId: acc.id,
      groupIds: [g.id],
    });
    s.deps.authorizer.checks.length = 0;
    await s.agentUc.updateAgent(s.db, s.actor, a.id, { name: 'P2' });
    expect(s.deps.authorizer.checks[0]).toMatchObject({
      action: 'agent.manage',
      resource: { agentId: a.id, agentGroupIds: [g.id] },
    });
    s.deps.authorizer.deny = () => true;
    const before = s.deps.audit.entries.length;
    expect(await code(s.agentUc.deleteAgent(s.db, s.actor, a.id))).toBe('forbidden');
    expect(s.deps.audit.entries).toHaveLength(before);
    s.deps.authorizer.deny = null;
    expect((await s.agentUc.getAgent(s.db, s.actor, a.id)).enabled).toBe(true);
  });
});

describe('ports', () => {
  it('AgentMembership and PolicyBindings reflect groups and policies', async () => {
    const s = setup();
    const acc = await withAccount(s);
    const p1 = randomUUID();
    const p2 = randomUUID();
    const orgPolicy = randomUUID();
    const g1 = await s.groupUc.createGroup(s.db, s.actor, { name: 'g1', policyId: p1 });
    const g2 = await s.groupUc.createGroup(s.db, s.actor, { name: 'g2' });
    const a = await s.agentUc.createAgent(s.db, s.actor, {
      slug: 'pb',
      name: 'PB',
      accountId: acc.id,
      policyId: p2,
      groupIds: [g1.id, g2.id],
    });
    const membership = createAgentMembership();
    expect((await membership.groupIdsOf(s.db, a.id)).sort()).toEqual([g1.id, g2.id].sort());
    expect(await membership.groupIdsOf(s.db, randomUUID())).toEqual([]);

    const seen: string[] = [];
    const bindings = createPolicyBindings({
      orgPolicyId: (_db, orgId) => {
        seen.push(orgId);
        return Promise.resolve(orgPolicy);
      },
    });
    const b = await bindings.forAgent(s.db, a.id);
    expect(b.orgPolicyId).toBe(orgPolicy);
    expect(b.agentPolicyId).toBe(p2);
    expect(b.groups).toEqual(
      expect.arrayContaining([
        { groupId: g1.id, policyId: p1 },
        { groupId: g2.id, policyId: null },
      ]),
    );
    expect(seen).toEqual([s.actor.orgId]);
    expect(await code(bindings.forAgent(s.db, randomUUID()))).toBe('not_found');
  });
});
