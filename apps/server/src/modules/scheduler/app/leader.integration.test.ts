import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../platform/db.ts';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createTasks } from '../../tasks/index.ts';
import { createScheduler } from '../index.ts';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('scheduler leader lock on real Postgres', () => {
  it('a tick does nothing while another transaction holds the lock', async () => {
    const database = await openDatabase({ databaseUrl: url });
    try {
      const deps = fakeDeps();
      const settings = new FakeOrgSettings();
      const taskApi = createTasks({ ...deps, orgSettings: settings });
      const scheduler = createScheduler({
        ...deps,
        orgSettings: settings,
        tasks: {
          createTask: (tx, actor, input) => taskApi.createTaskIn(tx, actor, input),
          hasOpenTaskOfSchedule: (tx, actor, id) => taskApi.hasOpenTaskOfSchedule(tx, actor, id),
          releaseDueScheduled: (tx, actor, now) => taskApi.releaseDueScheduled(tx, actor, now),
          resumeDueRateLimited: (tx, actor, now) => taskApi.resumeDueRateLimited(tx, actor, now),
        },
      });
      const user = testActor();
      const system = { ...user, kind: 'system' as const };
      await scheduler.createSchedule(database.db, user, {
        name: 'n',
        cron: '* * * * *',
        template: { title: 't', prompt: 'p', workDir: '/w', target: { label: 'x' } },
      });
      const later = new Date(Date.now() + 3_600_000);

      let release: () => void = () => undefined;
      let held: () => void = () => undefined;
      const holding = new Promise<void>((r) => (held = r));
      const gate = new Promise<void>((r) => (release = r));
      const holder = database.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agent-band:scheduler'))`);
        held();
        await gate;
      });
      await holding;
      const blocked = await scheduler.tick(database.db, system, later);
      expect(blocked).toMatchObject({ leader: false, fired: 0 });
      release();
      await holder;
      expect(await scheduler.tick(database.db, system, later)).toMatchObject({ leader: true, fired: 1 });
    } finally {
      await database.close();
    }
  });
});
