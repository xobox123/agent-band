import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type Database } from '../../platform/db.ts';
import { fakeDeps, FakeRunEventWriter } from '../../ports/testing.ts';
import { createAuthorizeToolCall, newRunToken, registerRunAuth, revokeRunAuth } from './run-auth.ts';

let database: Database;
let deps: ReturnType<typeof fakeDeps>;
let authorize: ReturnType<typeof createAuthorizeToolCall>;
const runId = randomUUID();
const orgId = randomUUID();
const agentId = randomUUID();
const token = newRunToken();
let events: FakeRunEventWriter;

beforeEach(async () => {
  database = await openTestDatabase();
  deps = fakeDeps();
  events = new FakeRunEventWriter();
  authorize = createAuthorizeToolCall({ ...deps, runs: events });
  await database.db.transaction((tx) =>
    registerRunAuth(tx, {
      runId,
      orgId,
      agentId,
      workDir: '/work/repo',
      token,
      policy: {
        deniedTools: ['WebFetch'],
        allowedTools: ['Read', 'Edit', 'WebFetch'],
        workDirSets: [['/work']],
      },
    }),
  );
});
afterEach(async () => {
  await database.close();
});

describe('authorizeToolCall', () => {
  it('allows an in-scope call and audits it with the agent as actor', async () => {
    const r = await authorize(database.db, runId, token, {
      toolName: 'Read',
      toolInput: { file_path: '/work/repo/a.ts' },
      toolUseId: 'tu1',
    });
    expect(r.decision).toBe('allow');
    expect(events.events).toEqual([{ kind: 'tool_decision', ...r, toolUseId: 'tu1' }]);
    expect(deps.audit.entries).toHaveLength(1);
    expect(deps.audit.entries[0]).toMatchObject({
      orgId,
      actorId: agentId,
      action: 'agent.tool_decision',
      targetType: 'run',
      targetId: runId,
      data: { tool: 'Read', decision: 'allow', toolUseId: 'tu1' },
    });
  });
  it('denies denied tools, tools outside the allow list and paths outside workDirs, with audit', async () => {
    const call = (toolName: string, toolInput?: unknown) =>
      authorize(database.db, runId, token, { toolName, toolInput });
    expect((await call('WebFetch')).decision).toBe('deny');
    expect((await call('Bash', { command: 'ls' })).reason).toContain('not in the allowed tools');
    const outside = await call('Edit', { file_path: '/etc/passwd' });
    expect(outside).toMatchObject({ decision: 'deny' });
    expect(outside.reason).toContain('outside the allowed directories');
    expect(deps.audit.entries.map((e) => (e.data as { decision: string }).decision)).toEqual([
      'deny',
      'deny',
      'deny',
    ]);
  });
  it('denies a bad, empty or foreign token and an unknown run without audit', async () => {
    const tool = { toolName: 'Read', toolInput: { file_path: '/work/a' } };
    for (const bad of ['', 'nope', newRunToken()]) {
      expect(await authorize(database.db, runId, bad, tool)).toEqual({
        decision: 'deny',
        reason: 'invalid run token',
      });
    }
    expect((await authorize(database.db, randomUUID(), token, tool)).decision).toBe('deny');
    expect(deps.audit.entries).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });
  it('denies after the run auth is revoked', async () => {
    await database.db.transaction((tx) => revokeRunAuth(tx, runId));
    const r = await authorize(database.db, runId, token, {
      toolName: 'Read',
      toolInput: { file_path: '/work/a' },
    });
    expect(r.decision).toBe('deny');
  });
});
