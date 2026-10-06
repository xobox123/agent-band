import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx, type Tx } from '../../../platform/tx.ts';
import { appendAudit } from '../../audit/index.ts';
import { organizations, principals, roleBindings } from '../infra/schema.ts';
import { createPrincipal } from './principals.ts';

const LOCAL_HANDLE = 'user:local';
const DISPATCHER_HANDLE = 'system:dispatcher';
const SCHEDULER_HANDLE = 'system:scheduler';

async function ensurePrincipal(
  tx: Tx,
  orgId: string,
  kind: 'user' | 'system',
  handle: string,
  displayName: string,
): Promise<string> {
  const rows = await tx
    .select({ id: principals.id })
    .from(principals)
    .where(and(eq(principals.orgId, orgId), eq(principals.handle, handle)));
  const existing = rows[0];
  if (existing) return existing.id;
  return (await createPrincipal(tx, { orgId, kind, handle, displayName })).id;
}

export async function bootstrapLocalOrg(db: Db): Promise<{
  orgId: string;
  localUser: ActorContext;
  dispatcher: ActorContext;
  scheduler: ActorContext;
}> {
  return withTx(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('org:bootstrap'))`);
    const orgs = await tx.select().from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
    let org = orgs[0];
    const fresh = !org;
    if (!org) {
      const created = await tx.insert(organizations).values({ name: 'Default' }).returning();
      org = created[0];
    }
    if (!org) throw new Error('organization insert returned no row');
    const orgId = org.id;

    const dispatcherId = await ensurePrincipal(tx, orgId, 'system', DISPATCHER_HANDLE, 'Dispatcher');
    const schedulerId = await ensurePrincipal(tx, orgId, 'system', SCHEDULER_HANDLE, 'Scheduler');
    const localId = await ensurePrincipal(tx, orgId, 'user', LOCAL_HANDLE, 'Local user');

    const owner = await tx
      .select({ id: roleBindings.id })
      .from(roleBindings)
      .where(
        and(
          eq(roleBindings.orgId, orgId),
          eq(roleBindings.subjectType, 'user'),
          eq(roleBindings.subjectId, localId),
          eq(roleBindings.role, 'owner'),
          eq(roleBindings.scopeType, 'org'),
        ),
      );
    if (owner.length === 0) {
      const rows = await tx
        .insert(roleBindings)
        .values({
          orgId,
          subjectType: 'user',
          subjectId: localId,
          role: 'owner',
          scopeType: 'org',
          scopeId: null,
          createdBy: dispatcherId,
        })
        .returning({ id: roleBindings.id });
      await appendAudit(tx, {
        orgId,
        actorId: dispatcherId,
        action: 'role_binding.create',
        targetType: 'role_binding',
        targetId: rows[0]?.id ?? '',
        data: { subject: { userId: localId }, role: 'owner', scope: { org: true }, bootstrap: true },
      });
    }
    if (fresh) {
      await appendAudit(tx, {
        orgId,
        actorId: dispatcherId,
        action: 'org.create',
        targetType: 'organization',
        targetId: orgId,
        data: { name: org.name },
      });
      await publish(tx, 'org.changed', { orgId, entity: 'organization', id: orgId, change: 'created' });
    }

    return {
      orgId,
      localUser: { orgId, principalId: localId, kind: 'user', requestId: randomUUID() },
      dispatcher: { orgId, principalId: dispatcherId, kind: 'system', requestId: randomUUID() },
      scheduler: { orgId, principalId: schedulerId, kind: 'system', requestId: randomUUID() },
    };
  });
}
