import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { expect, it } from 'vitest';
import { fakeDeps, FakeOrgSettings, testActor } from '../../../ports/testing.ts';
import { createTasks } from '../index.ts';

it.each(['/', '/.', '//', '/./nested//./child/../..', '//././/'])(
  'upgrades legacy folders with workspace suffix %s before duplication',
  async (suffix) => {
    const lite = new PGlite();
    const actor = testActor();
    const workspaceRoot = `${tmpdir()}/ab-upgrade-${randomUUID()}${suffix}`;
    const root = join(workspaceRoot, '.');
    const migrations = new URL('../../../../drizzle/', import.meta.url);
    try {
      const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrations), 'utf8')) as {
        entries: { idx: number; tag: string }[];
      };
      for (const entry of journal.entries.filter((entry) => entry.idx < 12)) {
        await lite.exec(await readFile(new URL(`${entry.tag}.sql`, migrations), 'utf8'));
      }
      await lite.query(
        'INSERT INTO organizations (id, name, timezone, workspace_root) VALUES ($1, $2, $3, $4)',
        [actor.orgId, 'Upgrade', 'UTC', workspaceRoot],
      );
      const autoSchedule = randomUUID();
      const explicitSchedule = randomUUID();
      const otherOrg = randomUUID();
      await lite.query(
        `INSERT INTO schedules (id, org_id, name, cron, template, next_fire_at, created_by)
       VALUES ($1, $2, 'Nightly Build!', '* * * * *', '{}', now(), $3),
              ($4, $2, 'Explicit', '* * * * *', $5, now(), $3),
              ($6, $7, 'Foreign', '* * * * *', '{}', now(), $3)`,
        [
          autoSchedule,
          actor.orgId,
          actor.principalId,
          explicitSchedule,
          JSON.stringify({ workDir: `${root}/AB-4` }),
          randomUUID(),
          otherOrg,
        ],
      );
      const cases = [
        { dir: `${root}/AB-1`, explicit: false },
        { dir: `${root}/nightly-build`, schedule: autoSchedule, explicit: false },
        { dir: `${root}/project`, explicit: true },
        { dir: `${root}/AB-4`, schedule: explicitSchedule, explicit: true },
        { dir: `${root}/custom-schedule`, schedule: autoSchedule, explicit: true },
        { dir: `${root}/AB-6`, parent: randomUUID(), explicit: true },
        { dir: '/old-workspace/AB-7', explicit: true },
        { dir: `${root}/nightly-build`, schedule: autoSchedule, org: otherOrg, explicit: true },
      ];
      const ids: string[] = [];
      for (const [index, c] of cases.entries()) {
        const id = randomUUID();
        ids.push(id);
        await lite.query(
          `INSERT INTO tasks (id, org_id, key, title, prompt, work_dir, target, created_by, schedule_id, parent_task_id)
         VALUES ($1, $2, $3, 'Legacy', 'Prompt', $4, '{"label":"be"}', $5, $6, $7)`,
          [
            id,
            c.org ?? actor.orgId,
            `AB-${index + 1}`,
            c.dir,
            actor.principalId,
            c.schedule ?? null,
            c.parent ?? null,
          ],
        );
      }
      await lite.query('INSERT INTO task_key_seq (org_id, seq) VALUES ($1, $2)', [actor.orgId, cases.length]);
      await lite.exec(await readFile(new URL('0012_task_workdir_explicit.sql', migrations), 'utf8'));
      const api = createTasks({ ...fakeDeps(), orgSettings: new FakeOrgSettings({ workspaceRoot: root }) });
      const db = drizzle(lite);
      for (const [index, c] of cases.entries()) {
        const scopedActor = { ...actor, orgId: c.org ?? actor.orgId };
        const id = ids[index];
        if (!id) throw new Error('Missing legacy task id');
        const task = await api.getTask(db, scopedActor, id);
        expect(task.workDir).toBe(c.dir);
        expect(task.workDirExplicit).toBe(c.explicit);
        if (c.parent) continue;
        const copy = await api.duplicateTask(db, scopedActor, id);
        expect(copy.status).toBe('draft');
        expect(copy.workDirExplicit).toBe(c.explicit);
        expect(copy.workDir).toBe(c.explicit ? c.dir : join(root, copy.key));
        if (!c.explicit) expect(copy.workDir).not.toBe(task.workDir);
      }
    } finally {
      await lite.close();
    }
  },
);
