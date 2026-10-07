import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { forbidden, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { ModuleDeps, OrgSettings, TaskPlanner } from '../../../ports/index.ts';
import { nextFire, nextFires, validateCron } from '../domain/cron.ts';
import {
  CreateSchedule,
  UpdateSchedule,
  type CreateScheduleInput,
  type ScheduleTemplate,
  type UpdateScheduleInput,
} from '../domain/schedule.ts';
import { schedules, type Schedule } from '../infra/schema.ts';

export interface SchedulerDeps extends ModuleDeps {
  orgSettings: OrgSettings;
  tasks: TaskPlanner;
  now?: () => Date;
}

export interface TickResult {
  /** False when another instance holds the leader lock. */
  leader: boolean;
  released: number;
  resumed: number;
  exhausted: number;
  fired: number;
  skipped: number;
  failed: number;
}

const LOCK_KEY = 'agent-band:scheduler';

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'schedule';

export function createScheduler(deps: SchedulerDeps) {
  const clock = () => deps.now?.() ?? new Date();
  const where = (actor: ActorContext, id: string) =>
    and(eq(schedules.orgId, actor.orgId), eq(schedules.id, id));

  async function timezoneOf(tx: Tx, orgId: string, own: string | null): Promise<string> {
    return own ?? (await deps.orgSettings.get(tx, orgId)).timezone;
  }
  async function audit(tx: Tx, actor: ActorContext, action: string, id: string, data?: unknown) {
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action,
      targetType: 'schedule',
      targetId: id,
      data,
    });
  }
  async function changed(tx: Tx, actor: ActorContext, schedule: Schedule, action: string, data?: unknown) {
    await audit(tx, actor, action, schedule.id, data);
    await publish(tx, 'schedule.updated', { orgId: actor.orgId, scheduleId: schedule.id });
    return schedule;
  }
  async function get(tx: Tx, actor: ActorContext, id: string): Promise<Schedule> {
    const [schedule] = await tx.select().from(schedules).where(where(actor, id)).for('update');
    if (!schedule) throw notFound('schedule');
    return schedule;
  }
  function system(actor: ActorContext) {
    if (actor.kind !== 'system') throw forbidden('System actor required');
  }
  const templateInput = (t: ScheduleTemplate, scheduleId: string, name: string) => ({
    ...t,
    scheduleId,
    workDirSlug: slugOf(name),
  });

  async function fire(tx: Tx, actor: ActorContext, s: Schedule, now: Date): Promise<'fired' | 'skipped'> {
    const tz = await timezoneOf(tx, s.orgId, s.timezone);
    const next = nextFire(s.cron, tz, now);
    if (s.overlap === 'skip' && (await deps.tasks.hasOpenTaskOfSchedule(tx, actor, s.id))) {
      const [updated] = await tx
        .update(schedules)
        .set({ nextFireAt: next, updatedAt: now })
        .where(where(actor, s.id))
        .returning();
      if (!updated) throw notFound('schedule');
      await changed(tx, actor, updated, 'schedule.skip', { reason: 'overlap' });
      return 'skipped';
    }
    const task = await deps.tasks.createTask(tx, actor, templateInput(s.template, s.id, s.name));
    const [updated] = await tx
      .update(schedules)
      .set({ lastFiredAt: now, lastTaskId: task.id, nextFireAt: next, updatedAt: now })
      .where(where(actor, s.id))
      .returning();
    if (!updated) throw notFound('schedule');
    await changed(tx, actor, updated, 'schedule.fire', { taskId: task.id });
    return 'fired';
  }

  async function tickIn(tx: Tx, actor: ActorContext, now: Date): Promise<TickResult> {
    const result: TickResult = {
      leader: false,
      released: 0,
      resumed: 0,
      exhausted: 0,
      fired: 0,
      skipped: 0,
      failed: 0,
    };
    const rows = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as locked`,
    )) as { rows: { locked: boolean }[] };
    if (!rows.rows[0]?.locked) return result;
    result.leader = true;

    result.released = (await deps.tasks.releaseDueScheduled(tx, actor, now)).length;
    const resume = await deps.tasks.resumeDueRateLimited(tx, actor, now);
    result.resumed = resume.resumed.length;
    result.exhausted = resume.exhausted.length;

    const due = await tx
      .select()
      .from(schedules)
      .where(
        and(eq(schedules.orgId, actor.orgId), eq(schedules.enabled, true), lte(schedules.nextFireAt, now)),
      )
      .orderBy(asc(schedules.nextFireAt), asc(schedules.id))
      .for('update', { skipLocked: true });
    for (const s of due) {
      try {
        // A savepoint keeps one broken schedule from rolling back the whole tick.
        const outcome = await tx.transaction((sub) => fire(sub, actor, s, now));
        if (outcome === 'fired') result.fired++;
        else result.skipped++;
      } catch (err) {
        result.failed++;
        // Move past this fire so a permanently failing schedule does not retry every tick.
        const tz = await timezoneOf(tx, s.orgId, s.timezone).catch(() => 'UTC');
        let next: Date;
        try {
          next = nextFire(s.cron, tz, now);
        } catch {
          next = new Date(now.getTime() + 24 * 3_600_000);
        }
        await tx.update(schedules).set({ nextFireAt: next, updatedAt: now }).where(where(actor, s.id));
        await audit(tx, actor, 'schedule.fire_failed', s.id, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  }

  return {
    /** One scheduler pass; does nothing unless this call holds the leader lock. */
    async tick(db: Db, actor: ActorContext, now: Date = clock()): Promise<TickResult> {
      system(actor);
      return db.transaction((tx) => tickIn(tx, actor, now));
    },

    async createSchedule(db: Db, actor: ActorContext, input: CreateScheduleInput): Promise<Schedule> {
      const parsed = CreateSchedule.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues);
      const data = parsed.data;
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'task.write', {});
        const now = clock();
        const tz = await timezoneOf(tx, actor.orgId, data.timezone ?? null);
        validateCron(data.cron, tz, now);
        const [schedule] = await tx
          .insert(schedules)
          .values({
            orgId: actor.orgId,
            name: data.name,
            enabled: data.enabled,
            cron: data.cron,
            timezone: data.timezone ?? null,
            template: data.template,
            overlap: data.overlap,
            nextFireAt: nextFire(data.cron, tz, now),
            createdBy: actor.principalId,
          })
          .returning();
        if (!schedule) throw new Error('Missing inserted schedule');
        return changed(tx, actor, schedule, 'schedule.create', { name: schedule.name, cron: schedule.cron });
      });
    },

    async updateSchedule(
      db: Db,
      actor: ActorContext,
      id: string,
      input: UpdateScheduleInput,
    ): Promise<Schedule> {
      const parsed = UpdateSchedule.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues);
      const patch = parsed.data;
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'task.write', {});
        const current = await get(tx, actor, id);
        const now = clock();
        const cron = patch.cron ?? current.cron;
        const timezone = patch.timezone === undefined ? current.timezone : patch.timezone;
        const enabled = patch.enabled ?? current.enabled;
        const tz = await timezoneOf(tx, actor.orgId, timezone);
        validateCron(cron, tz, now);
        const rescheduled =
          cron !== current.cron || timezone !== current.timezone || (enabled && !current.enabled);
        const [schedule] = await tx
          .update(schedules)
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.template !== undefined ? { template: patch.template } : {}),
            ...(patch.overlap !== undefined ? { overlap: patch.overlap } : {}),
            enabled,
            cron,
            timezone,
            ...(rescheduled ? { nextFireAt: nextFire(cron, tz, now) } : {}),
            updatedAt: now,
          })
          .where(where(actor, id))
          .returning();
        if (!schedule) throw notFound('schedule');
        return changed(tx, actor, schedule, 'schedule.update', { fields: Object.keys(patch) });
      });
    },

    async deleteSchedule(db: Db, actor: ActorContext, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'task.write', {});
        await get(tx, actor, id);
        const [removed] = await tx.delete(schedules).where(where(actor, id)).returning();
        if (!removed) throw notFound('schedule');
        await changed(tx, actor, removed, 'schedule.delete', { name: removed.name });
      });
    },

    async getSchedule(db: Db, actor: ActorContext, id: string): Promise<Schedule> {
      await deps.authorizer.authorize(db, actor, 'read', {});
      const [schedule] = await db.select().from(schedules).where(where(actor, id));
      if (!schedule) throw notFound('schedule');
      return schedule;
    },

    async listSchedules(db: Db, actor: ActorContext): Promise<Schedule[]> {
      await deps.authorizer.authorize(db, actor, 'read', {});
      return db
        .select()
        .from(schedules)
        .where(eq(schedules.orgId, actor.orgId))
        .orderBy(asc(schedules.name), asc(schedules.id));
    },

    /** Creates a task from the template now; the next cron fire is left untouched. */
    async runNow(db: Db, actor: ActorContext, id: string): Promise<{ schedule: Schedule; taskId: string }> {
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'task.write', {});
        const current = await get(tx, actor, id);
        const now = clock();
        const task = await deps.tasks.createTask(
          tx,
          actor,
          templateInput(current.template, id, current.name),
        );
        const [schedule] = await tx
          .update(schedules)
          .set({ lastFiredAt: now, lastTaskId: task.id, updatedAt: now })
          .where(where(actor, id))
          .returning();
        if (!schedule) throw notFound('schedule');
        await changed(tx, actor, schedule, 'schedule.run_now', { taskId: task.id });
        return { schedule, taskId: task.id };
      });
    },

    async preview(db: Db, actor: ActorContext, cron: string, timezone?: string): Promise<Date[]> {
      await deps.authorizer.authorize(db, actor, 'read', {});
      const tz = timezone ?? (await deps.orgSettings.get(db, actor.orgId)).timezone;
      return nextFires(cron, tz, clock());
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
