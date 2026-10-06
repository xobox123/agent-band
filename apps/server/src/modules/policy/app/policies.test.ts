import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { outboxEvents } from '../../../platform/schema.ts';
import { FakePolicyBindings, fakeDeps, testActor } from '../../../ports/testing.ts';
import { createPolicy, getEffectivePolicy, getPolicy, listPolicies, updatePolicy } from './policies.ts';

let database: Database;
const deps = fakeDeps();
const actor = testActor();

beforeEach(async () => {
  database = await openTestDatabase();
  deps.authorizer.checks.length = 0;
  deps.authorizer.deny = null;
  deps.audit.entries.length = 0;
});
afterEach(async () => {
  await database.close();
});

describe('policies', () => {
  it('writes no audit rows for list and get', async () => {
    const p = await createPolicy(database.db, deps, actor, { name: 'base', rules: { maxMode: 'edit' } });
    deps.audit.entries.length = 0;
    await getPolicy(database.db, deps, actor, p.id);
    await listPolicies(database.db, deps, actor);
    expect(deps.audit.entries).toEqual([]);
  });

  it('creates version 1 and audits, authorizes and publishes', async () => {
    const p = await createPolicy(database.db, deps, actor, { name: 'base', rules: { maxMode: 'edit' } });
    expect(p.currentVersion).toBe(1);
    expect(p.versions).toHaveLength(1);
    expect(deps.authorizer.checks[0]?.action).toBe('agent.manage');
    expect(deps.audit.entries.map((e) => e.action)).toEqual(['policy.create']);
    const events = await database.db.select().from(outboxEvents);
    expect(events.map((e) => e.type)).toEqual(['policy.updated']);
  });

  it('rules change creates an immutable new version, old version unchanged', async () => {
    const p = await createPolicy(database.db, deps, actor, { name: 'base', rules: { maxMode: 'edit' } });
    const u = await updatePolicy(database.db, deps, actor, p.id, { rules: { maxMode: 'read-only' } });
    expect(u.currentVersion).toBe(2);
    expect(u.rules).toEqual({ maxMode: 'read-only' });
    expect(u.versions.map((v) => [v.version, v.rules])).toEqual([
      [1, { maxMode: 'edit' }],
      [2, { maxMode: 'read-only' }],
    ]);
  });

  it('name and description change in place without a new version', async () => {
    const p = await createPolicy(database.db, deps, actor, { name: 'base', rules: { maxMode: 'edit' } });
    const u = await updatePolicy(database.db, deps, actor, p.id, { name: 'renamed', description: 'd' });
    expect(u.currentVersion).toBe(1);
    expect(u.versions).toHaveLength(1);
    expect([u.name, u.description]).toEqual(['renamed', 'd']);
    expect(deps.audit.entries.at(-1)?.action).toBe('policy.update');
  });

  it('identical rules do not create a version', async () => {
    const p = await createPolicy(database.db, deps, actor, {
      name: 'base',
      rules: { maxMode: 'edit', deniedTools: ['a'] },
    });
    const u = await updatePolicy(database.db, deps, actor, p.id, {
      rules: { deniedTools: ['a'], maxMode: 'edit' },
    });
    expect(u.currentVersion).toBe(1);
  });

  it('rejects invalid rules and duplicate names', async () => {
    await expect(
      createPolicy(database.db, deps, actor, { name: 'x', rules: { maxMode: 'root' } }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await createPolicy(database.db, deps, actor, { name: 'dup', rules: {} });
    await expect(createPolicy(database.db, deps, actor, { name: 'dup', rules: {} })).rejects.toMatchObject({
      code: 'policy_name_taken',
    });
  });

  it('is scoped to the org', async () => {
    const p = await createPolicy(database.db, deps, actor, { name: 'base', rules: {} });
    const other = testActor();
    await expect(getPolicy(database.db, deps, other, p.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await listPolicies(database.db, deps, other)).toEqual([]);
    await expect(updatePolicy(database.db, deps, other, p.id, { name: 'z' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('writes nothing when authorization is denied or audit fails', async () => {
    deps.authorizer.deny = () => true;
    await expect(createPolicy(database.db, deps, actor, { name: 'a', rules: {} })).rejects.toMatchObject({
      status: 403,
    });
    deps.authorizer.deny = null;
    const failing = { ...deps, audit: { append: () => Promise.reject(new Error('audit down')) } };
    await expect(createPolicy(database.db, failing, actor, { name: 'a', rules: {} })).rejects.toThrow(
      'audit down',
    );
    expect(await listPolicies(database.db, deps, actor)).toEqual([]);
    expect(await database.db.select().from(outboxEvents)).toEqual([]);
  });
});

describe('getEffectivePolicy', () => {
  it('merges org, group and agent levels with sources', async () => {
    const org = await createPolicy(database.db, deps, actor, {
      name: 'org',
      rules: { maxMode: 'full-auto', workDirs: ['/work'], deniedTools: ['Bash(rm)'], dailyTokenBudget: 1000 },
    });
    const group = await createPolicy(database.db, deps, actor, {
      name: 'group',
      rules: { maxMode: 'edit', allowedTools: ['Read', 'Edit'] },
    });
    const agent = await createPolicy(database.db, deps, actor, {
      name: 'agent',
      rules: { workDirs: ['/work/repo'], allowedTools: ['Edit', 'Grep'], dailyTokenBudget: 500 },
    });
    await updatePolicy(database.db, deps, actor, agent.id, {
      rules: { workDirs: ['/work/repo'], dailyTokenBudget: 400 },
    });
    const bindings = new FakePolicyBindings({
      orgPolicyId: org.id,
      groups: [
        { groupId: randomUUID(), policyId: group.id },
        { groupId: randomUUID(), policyId: null },
      ],
      agentPolicyId: agent.id,
    });
    const eff = await getEffectivePolicy(database.db, randomUUID(), { orgId: actor.orgId, bindings });
    expect(eff.maxMode).toBe('edit');
    expect(eff.workDirSets).toEqual([['/work'], ['/work/repo']]);
    expect(eff.allowedTools).toEqual(['Read', 'Edit']);
    expect(eff.deniedTools).toEqual(['Bash(rm)']);
    expect(eff.dailyTokenBudget).toBe(400);
    expect(eff.sources).toEqual([
      { level: 'org', policyId: org.id, version: 1 },
      { level: 'group', policyId: group.id, version: 1 },
      { level: 'agent', policyId: agent.id, version: 2 },
    ]);
  });

  it('returns the unrestricted default with no bindings', async () => {
    const eff = await getEffectivePolicy(database.db, randomUUID(), {
      orgId: actor.orgId,
      bindings: new FakePolicyBindings(),
    });
    expect(eff).toMatchObject({ workDirSets: [], maxMode: 'full-auto', deniedTools: [], sources: [] });
  });

  it('fails for a policy from another org', async () => {
    const other = testActor();
    const p = await createPolicy(database.db, deps, other, { name: 'x', rules: {} });
    const bindings = new FakePolicyBindings({ orgPolicyId: p.id, groups: [], agentPolicyId: null });
    await expect(
      getEffectivePolicy(database.db, randomUUID(), { orgId: actor.orgId, bindings }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
