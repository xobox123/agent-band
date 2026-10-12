import { hostname } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { makeKit } from './worker.testkit.ts';
import type { ProcessIdentity, ProcessTable } from '../runner/process-table.ts';

type Kit = Awaited<ReturnType<typeof makeKit>>;
const kits: Kit[] = [];
afterEach(async () => {
  await Promise.all(kits.splice(0).map((kit) => kit.close()));
});

const self: ProcessIdentity = {
  pid: process.pid,
  pgid: process.pid,
  startedAt: 'Mon Oct 12 13:00:00 2026',
  command: 'node',
};
const child: ProcessIdentity = {
  pid: 81234,
  pgid: 81234,
  startedAt: 'Mon Oct 12 12:00:00 2026',
  command: '/usr/local/bin/agy',
};

function processTable(childAlive = true): {
  table: ProcessTable;
  sent: NodeJS.Signals[];
} {
  let alive = childAlive;
  const sent: NodeJS.Signals[] = [];
  return {
    sent,
    table: {
      async read(pid) {
        if (pid === self.pid) return self;
        return alive && pid === child.pid ? child : null;
      },
      signalGroup(pgid, signal) {
        expect(pgid).toBe(child.pgid);
        sent.push(signal);
        alive = false;
      },
      async waitForExit() {
        return !alive;
      },
    },
  };
}

async function strandedRun(kit: Kit, ownerPid: number, withProcess = true) {
  const account = await kit.account('recovery');
  const agent = await kit.agent('recovery-agent', account.id);
  const task = await kit.task({ target: { agentId: agent.id } });
  const claimed = await kit.db.transaction((tx) =>
    kit.tasks.claimNextTask(tx, kit.dispatcher, 'worker-before-crash'),
  );
  expect(claimed?.id).toBe(task.id);
  await kit.db.transaction((tx) => kit.tasks.setTaskStatus(tx, kit.dispatcher, task.id, 'running'));
  const run = await kit.db.transaction((tx) =>
    kit.runs.startRun(tx, kit.dispatcher, {
      taskId: task.id,
      agentId: agent.id,
      accountId: account.id,
      workerId: 'worker-before-crash',
      owner: { host: hostname(), pid: ownerPid, startedAt: self.startedAt, command: self.command },
      effectivePolicy: {},
      skills: [],
    }),
  );
  if (withProcess) {
    await kit.db.transaction((tx) =>
      kit.runs.recordProcess(tx, kit.dispatcher, run.id, { ...child, host: hostname() }),
    );
  }
  return { task, run };
}

it('recovers lost runs after workerId changes and kills orphan CLI groups', async () => {
  const kit = await makeKit();
  kits.push(kit);
  const { task, run } = await strandedRun(kit, 99999);
  const { table, sent } = processTable();
  const worker = kit.worker({ workerId: 'worker-after-restart', processTable: table, slots: 1 });
  await worker.start();
  try {
    const recovered = await kit.runs.getRun(kit.db, kit.dispatcher, run.id);
    expect(recovered.status).toBe('failed');
    expect(recovered.processReapedAt).toBeInstanceOf(Date);
    expect((await kit.taskStatus(task.id))?.status).toBe('failed');
    expect(sent).toEqual(['SIGTERM']);
  } finally {
    await worker.stop({ force: true });
  }
});

it('retries cleanup of a terminal run left behind by a crash during cleanup', async () => {
  const kit = await makeKit();
  kits.push(kit);
  const { run } = await strandedRun(kit, 99999);
  await kit.db.transaction((tx) => kit.runs.finishRun(tx, kit.dispatcher, run.id, { status: 'failed' }));
  const { table, sent } = processTable();
  const worker = kit.worker({ processTable: table });
  await worker.start();
  try {
    expect(sent).toEqual(['SIGTERM']);
    expect((await kit.runs.getRun(kit.db, kit.dispatcher, run.id)).processReapedAt).toBeInstanceOf(Date);
  } finally {
    await worker.stop({ force: true });
  }
});

it('never recovers an active run owned by a live matching worker process', async () => {
  const kit = await makeKit();
  kits.push(kit);
  const { run } = await strandedRun(kit, self.pid, false);
  const { table, sent } = processTable();
  const worker = kit.worker({ workerId: 'different-worker', processTable: table });
  await worker.start();
  try {
    expect((await kit.runs.getRun(kit.db, kit.dispatcher, run.id)).status).toBe('running');
    expect(sent).toEqual([]);
  } finally {
    await worker.stop({ force: true });
  }
});
