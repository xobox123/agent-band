import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import { NormalizedEvent } from '@agent-band/contracts';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { DbOrTx, ModuleDeps } from '../../../ports/index.ts';
import { conflict, forbidden, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { runs, runEvents, type Run, type RunEvent } from '../infra/schema.ts';
import type { StartRunInput, FinishRunInput, RunStatus, UsageScope } from '../domain/run.ts';
export interface RunFilter {
  taskId?: string;
  agentId?: string;
  accountId?: string;
  status?: RunStatus;
}
export function createRuns(deps: ModuleDeps) {
  const where = (actor: ActorContext, id: string) => and(eq(runs.orgId, actor.orgId), eq(runs.id, id));
  function system(actor: ActorContext) {
    if (actor.kind !== 'system') throw forbidden('System actor required');
  }
  async function get(tx: Tx, actor: ActorContext, id: string) {
    const [run] = await tx.select().from(runs).where(where(actor, id)).for('update');
    if (!run) throw notFound('run');
    return run;
  }
  async function audit(
    tx: Tx,
    actor: ActorContext,
    action: string,
    run: Run,
    data?: unknown,
    actorId = actor.principalId,
  ) {
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId,
      action,
      targetType: 'run',
      targetId: run.id,
      data,
    });
  }
  async function changed(tx: Tx, actor: ActorContext, run: Run, action: string) {
    await audit(tx, actor, action, run, {
      effectivePolicy: run.effectivePolicy,
      skills: run.skills,
      status: run.status,
    });
    await publish(tx, 'run.updated', { orgId: actor.orgId, runId: run.id, taskId: run.taskId });
    return run;
  }
  async function finishRun(tx: Tx, actor: ActorContext, id: string, input: FinishRunInput): Promise<Run> {
    system(actor);
    const run = await get(tx, actor, id);
    await deps.authorizer.authorize(tx, actor, 'task.write', { agentId: run.agentId });
    if (run.status !== 'running') throw conflict('run_terminal', 'Run is already terminal');
    const [limited] = await tx
      .select()
      .from(runEvents)
      .where(
        and(
          eq(runEvents.orgId, actor.orgId),
          eq(runEvents.runId, id),
          eq(runEvents.kind, 'rate_limit'),
          sql`${runEvents.payload}->>'limitReached' = 'true'`,
        ),
      )
      .orderBy(desc(runEvents.id))
      .limit(1);
    const limit = limited?.payload.kind === 'rate_limit' ? limited.payload : undefined;
    const [updated] = await tx
      .update(runs)
      .set({
        ...input,
        ...(limit
          ? {
              status: 'rate_limited' as const,
              rateLimitResetsAt: limit.resetsAt ? new Date(limit.resetsAt) : input.rateLimitResetsAt,
            }
          : {}),
        finishedAt: new Date(),
      })
      .where(where(actor, id))
      .returning();
    if (!updated) throw notFound('run');
    return changed(tx, actor, updated, 'run.finish');
  }
  return {
    async startRun(tx: Tx, actor: ActorContext, input: StartRunInput): Promise<Run> {
      system(actor);
      await deps.authorizer.authorize(tx, actor, 'task.write', { agentId: input.agentId });
      const [run] = await tx
        .insert(runs)
        .values({ ...input, orgId: actor.orgId })
        .returning();
      if (!run) throw new Error('Missing inserted run');
      return changed(tx, actor, run, 'run.start');
    },
    async appendRunEvent(tx: Tx, actor: ActorContext, id: string, input: NormalizedEvent): Promise<RunEvent> {
      system(actor);
      const parsed = NormalizedEvent.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues);
      const event = parsed.data;
      const run = await get(tx, actor, id);
      await deps.authorizer.authorize(tx, actor, 'task.write', { agentId: run.agentId });
      if (run.status !== 'running') throw conflict('run_terminal', 'Cannot append to a finished run');
      if (event.kind === 'usage') {
        if (
          [event.inputTokens, event.outputTokens, event.cachedTokens].some(
            (n) => !Number.isSafeInteger(n) || n < 0,
          ) ||
          (event.costUsd !== undefined && (!Number.isFinite(event.costUsd) || event.costUsd < 0))
        )
          throw invalid('Invalid usage');
        await tx
          .update(runs)
          .set({
            inputTokens: sql`${runs.inputTokens}+${event.inputTokens}`,
            outputTokens: sql`${runs.outputTokens}+${event.outputTokens}`,
            cachedTokens: sql`${runs.cachedTokens}+${event.cachedTokens}`,
            costUsd:
              event.costUsd === undefined ? runs.costUsd : sql`coalesce(${runs.costUsd},0)+${event.costUsd}`,
          })
          .where(where(actor, id));
        await publish(tx, 'run.updated', { orgId: actor.orgId, runId: id, taskId: run.taskId });
      }
      const [stored] = await tx
        .insert(runEvents)
        .values({ orgId: actor.orgId, runId: id, kind: event.kind, payload: event })
        .returning();
      if (!stored) throw new Error('Missing inserted event');
      const auditAction =
        event.kind === 'tool'
          ? 'agent.tool_use'
          : event.kind === 'rate_limit' && event.limitReached
            ? 'run.rate_limited'
            : undefined;
      if (auditAction)
        await audit(
          tx,
          actor,
          auditAction,
          run,
          {
            eventId: stored.id,
            kind: event.kind,
            ...(event.kind === 'tool'
              ? { name: event.name, input: JSON.stringify(event.input ?? null).slice(0, 2000) }
              : {}),
          },
          // Tool use is attributed to the agent that performed it.
          event.kind === 'tool' ? run.agentId : undefined,
        );
      await publish(tx, 'run.event', { orgId: actor.orgId, runId: id, eventId: stored.id });
      return stored;
    },
    finishRun,
    async listRuns(db: Db, actor: ActorContext, filter: RunFilter = {}): Promise<Run[]> {
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'read', filter.agentId ? { agentId: filter.agentId } : {});
        const result = await tx
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.orgId, actor.orgId),
              filter.taskId ? eq(runs.taskId, filter.taskId) : undefined,
              filter.agentId ? eq(runs.agentId, filter.agentId) : undefined,
              filter.accountId ? eq(runs.accountId, filter.accountId) : undefined,
              filter.status ? eq(runs.status, filter.status) : undefined,
            ),
          )
          .orderBy(desc(runs.startedAt), desc(runs.id));
        return result;
      });
    },
    async getRun(db: Db, actor: ActorContext, id: string): Promise<Run> {
      const [run] = await db.select().from(runs).where(where(actor, id));
      if (!run) throw notFound('run');
      await deps.authorizer.authorize(db, actor, 'read', { agentId: run.agentId });
      return run;
    },
    async listRunEvents(db: Db, actor: ActorContext, id: string, afterId = 0): Promise<RunEvent[]> {
      return db.transaction(async (tx) => {
        const run = await get(tx, actor, id);
        await deps.authorizer.authorize(tx, actor, 'read', { agentId: run.agentId });
        const result = await tx
          .select()
          .from(runEvents)
          .where(and(eq(runEvents.orgId, actor.orgId), eq(runEvents.runId, id), gt(runEvents.id, afterId)))
          .orderBy(asc(runEvents.id));
        return result;
      });
    },
    async recoverStaleRuns(db: Db, actor: ActorContext, workerId?: string): Promise<Run[]> {
      system(actor);
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'task.write', {});
        const stale = await tx
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.orgId, actor.orgId),
              eq(runs.status, 'running'),
              workerId ? eq(runs.workerId, workerId) : undefined,
            ),
          )
          .orderBy(asc(runs.id))
          .for('update', { skipLocked: true });
        const result: Run[] = [];
        for (const run of stale)
          result.push(
            await finishRun(tx, actor, run.id, {
              status: 'failed',
              error: 'Worker stopped before run finished',
            }),
          );
        return result;
      });
    },
    async runningCount(db: DbOrTx, actor: ActorContext, accountId: string): Promise<number> {
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'read', {});
        const [row] = await tx
          .select({ n: count() })
          .from(runs)
          .where(and(eq(runs.orgId, actor.orgId), eq(runs.accountId, accountId), eq(runs.status, 'running')));
        return row?.n ?? 0;
      });
    },
    async usageOnDay(
      db: DbOrTx,
      actor: ActorContext,
      scope: UsageScope,
      timezone: string,
      now: Date,
      kind: 'billable' | 'cached' = 'billable',
    ): Promise<number> {
      const sum =
        kind === 'cached'
          ? sql`(${runEvents.payload}->>'cachedTokens')::double precision`
          : sql`(${runEvents.payload}->>'inputTokens')::double precision + (${runEvents.payload}->>'outputTokens')::double precision`;
      return db.transaction(async (tx) => {
        await deps.authorizer.authorize(tx, actor, 'read', scope.agentId ? { agentId: scope.agentId } : {});
        const [row] = await tx
          .select({
            tokens: sql<number>`coalesce(sum(${sum}),0)`.mapWith(Number),
          })
          .from(runEvents)
          .innerJoin(runs, and(eq(runs.id, runEvents.runId), eq(runs.orgId, actor.orgId)))
          .where(
            and(
              eq(runEvents.orgId, actor.orgId),
              eq(runEvents.kind, 'usage'),
              scope.agentId ? eq(runs.agentId, scope.agentId) : undefined,
              scope.accountId ? eq(runs.accountId, scope.accountId) : undefined,
              sql`(${runEvents.ts} at time zone ${timezone})::date = (${now.toISOString()}::timestamptz at time zone ${timezone})::date`,
            ),
          );
        return row?.tokens ?? 0;
      });
    },
  };
}
