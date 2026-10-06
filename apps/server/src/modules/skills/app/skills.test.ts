import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { outboxEvents } from '../../../platform/schema.ts';
import { FakeAgentMembership, fakeDeps, testActor } from '../../../ports/testing.ts';
import {
  assignSkill,
  getEffectiveSkills,
  getSkill,
  importSkill,
  listSkillAssignments,
  listSkills,
  loadSkillBundle,
  newSkillVersion,
  unassignSkill,
} from './skills.ts';

let database: Database;
const deps = fakeDeps();
const actor = testActor();
const b64 = (s: string | Uint8Array): string => Buffer.from(s).toString('base64');
const files = (skill: string, extra: Record<string, string> = {}): Record<string, string> => ({
  'SKILL.md': b64(skill),
  ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, b64(v)])),
});

beforeEach(async () => {
  database = await openTestDatabase();
  deps.authorizer.checks.length = 0;
  deps.authorizer.deny = null;
  deps.audit.entries.length = 0;
});
afterEach(async () => {
  await database.close();
});

describe('importSkill', () => {
  it('creates version 1 with a content hash, audit and event', async () => {
    const s = await importSkill(database.db, deps, actor, { name: 'review', files: files('# review') });
    expect(s.currentVersion).toBe(1);
    expect(s.versions[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(deps.audit.entries.map((e) => e.action)).toEqual(['skill.import']);
    expect((await database.db.select().from(outboxEvents)).map((e) => e.type)).toEqual(['skill.updated']);
  });

  it('files map and zip give the same hash for the same content', async () => {
    const zip = b64(
      zipSync({ 'a/z.txt': new TextEncoder().encode('z'), 'SKILL.md': new TextEncoder().encode('# s') }),
    );
    const a = await importSkill(database.db, deps, actor, {
      name: 'one',
      files: files('# s', { 'a/z.txt': 'z' }),
    });
    const b = await importSkill(database.db, deps, actor, { name: 'two', zip });
    expect(b.versions[0]?.contentHash).toBe(a.versions[0]?.contentHash);
  });

  it('rejects path traversal, missing SKILL.md, both or neither source, bad names', async () => {
    await expect(
      importSkill(database.db, deps, actor, { name: 'bad', files: files('x', { '../evil': 'x' }) }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      importSkill(database.db, deps, actor, { name: 'bad', files: { 'readme.md': b64('x') } }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(importSkill(database.db, deps, actor, { name: 'bad' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      importSkill(database.db, deps, actor, { name: 'Bad Name', files: files('x') }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await listSkills(database.db, deps, actor)).toEqual([]);
  });

  it('rejects a duplicate name', async () => {
    await importSkill(database.db, deps, actor, { name: 'dup', files: files('a') });
    await expect(
      importSkill(database.db, deps, actor, { name: 'dup', files: files('b') }),
    ).rejects.toMatchObject({
      code: 'skill_name_taken',
    });
  });

  it('writes nothing when the audit append fails', async () => {
    const failing = { ...deps, audit: { append: () => Promise.reject(new Error('audit down')) } };
    await expect(importSkill(database.db, failing, actor, { name: 's', files: files('a') })).rejects.toThrow(
      'audit down',
    );
    expect(await listSkills(database.db, deps, actor)).toEqual([]);
  });

  it('denies without agent.manage', async () => {
    deps.authorizer.deny = (action) => action === 'agent.manage';
    await expect(
      importSkill(database.db, deps, actor, { name: 's', files: files('a') }),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('versions', () => {
  it('new versions are immutable and loadSkillBundle returns each version', async () => {
    const s = await importSkill(database.db, deps, actor, {
      name: 'v',
      files: files('one', { 'x.txt': 'x1' }),
    });
    const s2 = await newSkillVersion(database.db, deps, actor, s.id, { files: files('two') });
    expect(s2.currentVersion).toBe(2);
    expect(s2.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(s2.versions[0]?.contentHash).toBe(s.versions[0]?.contentHash);

    const v1 = await loadSkillBundle(database.db, s.id, 1, actor.orgId);
    const v2 = await loadSkillBundle(database.db, s.id, 2, actor.orgId);
    expect(Object.keys(v1.files).sort()).toEqual(['SKILL.md', 'x.txt']);
    expect(new TextDecoder().decode(v1.files['SKILL.md'])).toBe('one');
    expect(Object.keys(v2.files)).toEqual(['SKILL.md']);
    expect(v1.contentHash).toBe(s.versions[0]?.contentHash);
  });

  it('rejects identical content and unknown skills', async () => {
    const s = await importSkill(database.db, deps, actor, { name: 'v', files: files('one') });
    await expect(
      newSkillVersion(database.db, deps, actor, s.id, { files: files('one') }),
    ).rejects.toMatchObject({
      code: 'skill_unchanged',
    });
    await expect(
      newSkillVersion(database.db, deps, actor, randomUUID(), { files: files('x') }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is scoped to the org', async () => {
    const s = await importSkill(database.db, deps, actor, { name: 'v', files: files('one') });
    const other = testActor();
    await expect(getSkill(database.db, deps, other, s.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(loadSkillBundle(database.db, s.id, 1, other.orgId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      assignSkill(database.db, deps, other, { skillId: s.id, scope: { org: true } }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('assignments and effective skills', () => {
  it('unions org, group and agent assignments with dedupe, pins and specificity', async () => {
    const a = await importSkill(database.db, deps, actor, { name: 'alpha', files: files('a1') });
    await newSkillVersion(database.db, deps, actor, a.id, { files: files('a2') });
    const b = await importSkill(database.db, deps, actor, { name: 'beta', files: files('b1') });
    const c = await importSkill(database.db, deps, actor, { name: 'gamma', files: files('c1') });
    await importSkill(database.db, deps, actor, { name: 'unassigned', files: files('u') });

    const agentId = randomUUID();
    const groupId = randomUUID();
    await assignSkill(database.db, deps, actor, { skillId: a.id, scope: { org: true }, pinnedVersion: 1 });
    await assignSkill(database.db, deps, actor, { skillId: b.id, scope: { agentGroupId: groupId } });
    await assignSkill(database.db, deps, actor, { skillId: b.id, scope: { agentId }, pinnedVersion: 1 });
    await assignSkill(database.db, deps, actor, { skillId: c.id, scope: { agentGroupId: randomUUID() } });
    await assignSkill(database.db, deps, actor, { skillId: c.id, scope: { agentId: randomUUID() } });

    const membership = new FakeAgentMembership({ [agentId]: [groupId] });
    const eff = await getEffectiveSkills(database.db, agentId, { orgId: actor.orgId, membership });
    expect(eff.map((s) => [s.name, s.version])).toEqual([
      ['alpha', 1],
      ['beta', 1],
    ]);
    expect(eff[0]?.contentHash).toBe(a.versions[0]?.contentHash);
  });

  it('unpinned assignments follow the current version', async () => {
    const a = await importSkill(database.db, deps, actor, { name: 'alpha', files: files('a1') });
    await assignSkill(database.db, deps, actor, { skillId: a.id, scope: { org: true } });
    const ctx = { orgId: actor.orgId, membership: new FakeAgentMembership() };
    const agentId = randomUUID();
    expect((await getEffectiveSkills(database.db, agentId, ctx))[0]?.version).toBe(1);
    await newSkillVersion(database.db, deps, actor, a.id, { files: files('a2') });
    expect((await getEffectiveSkills(database.db, agentId, ctx))[0]?.version).toBe(2);
  });

  it('authorizes by scope: org.manage for org, agent.manage for group and agent', async () => {
    const a = await importSkill(database.db, deps, actor, { name: 'alpha', files: files('a1') });
    deps.authorizer.checks.length = 0;
    const groupId = randomUUID();
    const agentId = randomUUID();
    await assignSkill(database.db, deps, actor, { skillId: a.id, scope: { org: true } });
    await assignSkill(database.db, deps, actor, { skillId: a.id, scope: { agentGroupId: groupId } });
    await assignSkill(database.db, deps, actor, { skillId: a.id, scope: { agentId } });
    expect(deps.authorizer.checks.map((c) => [c.action, c.resource])).toEqual([
      ['org.manage', {}],
      ['agent.manage', { agentGroupIds: [groupId] }],
      ['agent.manage', { agentId }],
    ]);
  });

  it('rejects duplicate assignment, unknown pin; unassign removes and audits', async () => {
    const a = await importSkill(database.db, deps, actor, { name: 'alpha', files: files('a1') });
    const asg = await assignSkill(database.db, deps, actor, { skillId: a.id, scope: { org: true } });
    await expect(
      assignSkill(database.db, deps, actor, { skillId: a.id, scope: { org: true } }),
    ).rejects.toMatchObject({ code: 'skill_already_assigned' });
    await expect(
      assignSkill(database.db, deps, actor, {
        skillId: a.id,
        scope: { agentId: randomUUID() },
        pinnedVersion: 9,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    expect(await listSkillAssignments(database.db, deps, actor, { skillId: a.id })).toHaveLength(1);
    await unassignSkill(database.db, deps, actor, asg.id);
    expect(await listSkillAssignments(database.db, deps, actor)).toEqual([]);
    expect(deps.audit.entries.map((e) => e.action).slice(-2)).toEqual(['skill.assign', 'skill.unassign']);
    await expect(unassignSkill(database.db, deps, actor, asg.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
