import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RUN_TOKEN_HEADER } from '@agent-band/contracts';
import { newRunToken, registerRunAuth } from '../../execution/index.ts';
import { withTx } from '../../platform/tx.ts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  await api.close();
});

async function register(token: string): Promise<string> {
  const run = await withTx(api.database.db, (tx) =>
    api.c.runs.startRun(
      tx,
      { ...api.c.localUser, kind: 'system' },
      {
        taskId: randomUUID(),
        agentId: randomUUID(),
        accountId: randomUUID(),
        workerId: 'test',
        effectivePolicy: {},
        skills: [],
      },
    ),
  );
  const runId = run.id;
  await withTx(api.database.db, (tx) =>
    registerRunAuth(tx, {
      runId,
      orgId: api.c.orgId,
      agentId: run.agentId,
      workDir: '/work/run',
      token,
      policy: { deniedTools: ['Bash'], workDirSets: [] },
    }),
  );
  return runId;
}

const authorize = (runId: string, toolName: string, token?: string) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/runs/${runId}/authorize-tool`,
    headers: token === undefined ? {} : { [RUN_TOKEN_HEADER]: token },
    payload: { runId, toolName, toolUseId: 'tool-1' },
  });

it('allows a permitted tool and denies a policy-denied one, both with 200', async () => {
  const token = newRunToken();
  const runId = await register(token);
  const allowed = await authorize(runId, 'WebFetch', token);
  expect(allowed.statusCode).toBe(200);
  expect(allowed.json<{ decision: string }>().decision).toBe('allow');
  const denied = await authorize(runId, 'Bash', token);
  expect(denied.statusCode).toBe(200);
  expect(denied.json<{ decision: string }>().decision).toBe('deny');
  const events = await api.c.runs.listRunEvents(api.database.db, api.c.localUser, runId);
  expect(events.map((e) => e.payload)).toEqual([
    expect.objectContaining({ kind: 'tool_decision', decision: 'allow', toolUseId: 'tool-1' }),
    expect.objectContaining({ kind: 'tool_decision', decision: 'deny', toolUseId: 'tool-1' }),
  ]);
});

it('denies a wrong token and a missing token without requiring a user actor', async () => {
  const runId = await register(newRunToken());
  const bad = await authorize(runId, 'Read', 'nope');
  expect(bad.statusCode).toBe(200);
  expect(bad.json()).toEqual({ decision: 'deny', reason: 'invalid run token' });
  const missing = await authorize(runId, 'Read');
  expect(missing.statusCode).toBe(200);
  expect(missing.json()).toEqual({ decision: 'deny', reason: 'missing run token' });
});
