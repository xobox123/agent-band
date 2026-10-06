import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../platform/actor.ts';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { EventStream, type OutboxEvent } from '../../../platform/outbox.ts';
import { withTx } from '../../../platform/tx.ts';
import { createAudit } from '../../audit/index.ts';
import {
  authorize,
  authorizer,
  bootstrapLocalOrg,
  createPrincipal,
  orgSettings,
  orgUseCases,
} from '../index.ts';
import { getOrganization, setOrgPolicy, updateOrganization } from '../index.ts';

const at = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('unexpected undefined');
  return v;
};

let database: Database | undefined;
afterEach(async () => {
  await database?.close();
  database = undefined;
});

async function setup() {
  const opened = await openTestDatabase();
  database = opened;
  const db = opened.db;
  const boot = await bootstrapLocalOrg(db);
  const audit = createAudit(authorizer);
  async function makeUser(handle: string): Promise<ActorContext> {
    const { id } = await withTx(db, (tx) =>
      createPrincipal(tx, { orgId: boot.orgId, kind: 'user', handle, displayName: handle }),
    );
    return { orgId: boot.orgId, principalId: id, kind: 'user', requestId: randomUUID() };
  }
  return { database: opened, db, boot, audit, makeUser };
}

describe('bootstrapLocalOrg', () => {
  it('is idempotent and creates owner binding, local user and dispatcher', async () => {
    const { db, boot, audit } = await setup();
    const again = await bootstrapLocalOrg(db);
    expect(again.orgId).toBe(boot.orgId);
    expect(again.localUser.principalId).toBe(boot.localUser.principalId);
    expect(again.dispatcher.principalId).toBe(boot.dispatcher.principalId);
    expect(boot.localUser.kind).toBe('user');
    expect(boot.dispatcher.kind).toBe('system');
    expect(boot.scheduler.kind).toBe('system');
    expect(again.scheduler.principalId).toBe(boot.scheduler.principalId);
    expect(boot.scheduler.principalId).not.toBe(boot.dispatcher.principalId);
    expect(
      (await orgUseCases.listPrincipals(db, boot.localUser, { kind: 'system' })).map((p) => p.handle).sort(),
    ).toEqual(['system:dispatcher', 'system:scheduler']);

    const bindings = await orgUseCases.listRoleBindings(db, boot.localUser);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ role: 'owner', scope: { org: true } });
    const users = await orgUseCases.listUsers(db, boot.localUser);
    expect(users.map((u) => u.handle)).toEqual(['user:local']);
    expect((await audit.verifyAudit(db, boot.localUser)).ok).toBe(true);
  });

  it('survives concurrent bootstrap calls', async () => {
    const opened = await openTestDatabase();
    database = opened;
    const results = await Promise.all(Array.from({ length: 5 }, () => bootstrapLocalOrg(opened.db)));
    expect(new Set(results.map((r) => r.orgId)).size).toBe(1);
  });
});

describe('authorize', () => {
  it('viewer cannot create a role binding: 403 and authz.denied audited', async () => {
    const { db, boot, audit, makeUser } = await setup();
    const viewer = await makeUser('user:viewer');
    await orgUseCases.createRoleBinding(db, boot.localUser, {
      subject: { userId: viewer.principalId },
      role: 'viewer',
      scope: { org: true },
    });
    await expect(
      orgUseCases.createRoleBinding(db, viewer, {
        subject: { userId: viewer.principalId },
        role: 'owner',
        scope: { org: true },
      }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });

    const list = await audit.listAudit(db, boot.localUser, { action: 'authz.denied' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ actorId: viewer.principalId, targetId: 'org.manage' });
    // viewer still reads
    expect(await orgUseCases.listRoleBindings(db, viewer)).toHaveLength(2);
  });

  it('team binding grants operator to members only', async () => {
    const { db, boot, makeUser } = await setup();
    const member = await makeUser('user:member');
    const outsider = await makeUser('user:outsider');
    const team = await orgUseCases.createTeam(db, boot.localUser, { name: 'ops' });
    await orgUseCases.addTeamMember(db, boot.localUser, { teamId: team.id, userId: member.principalId });
    await orgUseCases.createRoleBinding(db, boot.localUser, {
      subject: { teamId: team.id },
      role: 'operator',
      scope: { org: true },
    });
    await expect(authorize(db, member, 'task.write', {})).resolves.toBeUndefined();
    await expect(authorize(db, member, 'agent.manage', {})).rejects.toMatchObject({ status: 403 });
    await expect(authorize(db, outsider, 'read', {})).rejects.toMatchObject({ status: 403 });
    const teams = await orgUseCases.listTeams(db, boot.localUser);
    expect(teams[0]?.memberIds).toEqual([member.principalId]);
  });

  it('scoped bindings respect the resource', async () => {
    const { db, boot, makeUser } = await setup();
    const u = await makeUser('user:scoped');
    const groupId = randomUUID();
    await orgUseCases.createRoleBinding(db, boot.localUser, {
      subject: { userId: u.principalId },
      role: 'admin',
      scope: { agentGroupId: groupId },
    });
    await expect(authorize(db, u, 'agent.manage', { agentGroupIds: [groupId] })).resolves.toBeUndefined();
    await expect(authorize(db, u, 'agent.manage', { agentGroupIds: [randomUUID()] })).rejects.toMatchObject({
      status: 403,
    });
    await expect(authorize(db, u, 'org.manage', {})).rejects.toMatchObject({ status: 403 });
  });

  it('system and agent actors are limited to internal actions', async () => {
    const { db, boot } = await setup();
    await expect(authorize(db, boot.dispatcher, 'task.write', {})).resolves.toBeUndefined();
    await expect(authorize(db, boot.dispatcher, 'org.manage', {})).rejects.toMatchObject({ status: 403 });
    const agent: ActorContext = { ...boot.dispatcher, kind: 'agent' };
    await expect(authorize(db, agent, 'read', {})).resolves.toBeUndefined();
    await expect(authorize(db, agent, 'agent.manage', {})).rejects.toMatchObject({ status: 403 });
  });

  it('implements the Authorizer port', async () => {
    const { db, boot } = await setup();
    await expect(authorizer.authorize(db, boot.localUser, 'audit.export', {})).resolves.toBeUndefined();
  });
});

describe('org use cases', () => {
  it('rejects duplicate handles and duplicate teams', async () => {
    const { db, boot } = await setup();
    await expect(
      withTx(db, (tx) =>
        createPrincipal(tx, { orgId: boot.orgId, kind: 'user', handle: 'user:local', displayName: 'x' }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await orgUseCases.createTeam(db, boot.localUser, { name: 'a' });
    await expect(orgUseCases.createTeam(db, boot.localUser, { name: 'a' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('validates input', async () => {
    const { db, boot } = await setup();
    await expect(orgUseCases.createTeam(db, boot.localUser, { name: '' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      orgUseCases.createRoleBinding(db, boot.localUser, {
        subject: { userId: 'x' },
        role: 'owner',
        scope: { org: true },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to delete the last owner binding, deletes others, audits both', async () => {
    const { db, boot, audit, makeUser } = await setup();
    const [owner] = await orgUseCases.listRoleBindings(db, boot.localUser);
    await expect(
      orgUseCases.deleteRoleBinding(db, boot.localUser, { id: at(owner).id }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'last_owner',
    });
    const u = await makeUser('user:tmp');
    const b = await orgUseCases.createRoleBinding(db, boot.localUser, {
      subject: { userId: u.principalId },
      role: 'operator',
      scope: { agentId: randomUUID() },
    });
    await orgUseCases.deleteRoleBinding(db, boot.localUser, { id: b.id });
    await expect(orgUseCases.deleteRoleBinding(db, boot.localUser, { id: b.id })).rejects.toMatchObject({
      status: 404,
    });
    const actions = (await audit.listAudit(db, boot.localUser, { targetType: 'role_binding' })).items.map(
      (i) => i.action,
    );
    expect(actions).toEqual(['role_binding.delete', 'role_binding.create', 'role_binding.create']);
  });

  it('rejects bindings for unknown subjects', async () => {
    const { db, boot } = await setup();
    await expect(
      orgUseCases.createRoleBinding(db, boot.localUser, {
        subject: { teamId: randomUUID() },
        role: 'viewer',
        scope: { org: true },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('publishes org.changed outbox events', async () => {
    const { database: opened, db, boot } = await setup();
    const stream = new EventStream(opened);
    const got: OutboxEvent[] = [];
    stream.subscribe((e) => got.push(e));
    await stream.start();
    const team = await orgUseCases.createTeam(db, boot.localUser, { name: 'evt' });
    await new Promise((r) => setTimeout(r, 150));
    await stream.stop();
    expect(got.some((e) => e.type === 'org.changed' && (e.payload as { id: string }).id === team.id)).toBe(
      true,
    );
  });
});

describe('organization settings', () => {
  it('defaults timezone to host tz and exposes OrgSettings', async () => {
    const { db, boot } = await setup();
    const org = await getOrganization(db, boot.orgId);
    expect(org.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(org.policyId).toBeNull();
    expect(await orgSettings.get(db, boot.orgId)).toEqual({ taskKeyPrefix: 'AB', timezone: org.timezone });
  });

  it('updates settings with validation, authorization and audit', async () => {
    const { db, boot, audit, makeUser } = await setup();
    const updated = await updateOrganization(db, boot.localUser, {
      timezone: 'Europe/Warsaw',
      taskKeyPrefix: 'XY',
      name: 'Acme',
    });
    expect(updated).toMatchObject({ timezone: 'Europe/Warsaw', taskKeyPrefix: 'XY', name: 'Acme' });
    expect(await orgSettings.get(db, boot.orgId)).toEqual({ taskKeyPrefix: 'XY', timezone: 'Europe/Warsaw' });
    await expect(updateOrganization(db, boot.localUser, { timezone: 'Mars/Base' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateOrganization(db, boot.localUser, { taskKeyPrefix: 'a' })).rejects.toMatchObject({
      status: 400,
    });
    const viewer = await makeUser('user:v');
    await expect(updateOrganization(db, viewer, { name: 'x' })).rejects.toMatchObject({ status: 403 });
    expect((await audit.listAudit(db, boot.localUser, { action: 'org.update' })).items).toHaveLength(1);
  });

  it('sets and clears the org policy id', async () => {
    const { db, boot } = await setup();
    const policyId = randomUUID();
    expect((await setOrgPolicy(db, boot.localUser, { policyId })).policyId).toBe(policyId);
    expect((await setOrgPolicy(db, boot.localUser, { policyId: null })).policyId).toBeNull();
  });
});

describe('schema', () => {
  it('has no foreign key from audit_events', async () => {
    const { db } = await setup();
    const res = (await db.execute(
      sql`select count(*)::int as n from pg_constraint where contype = 'f' and conrelid = 'audit_events'::regclass`,
    )) as { rows: { n: number }[] };
    expect(res.rows[0]?.n).toBe(0);
  });
});
