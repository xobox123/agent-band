import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import { withTx, type Tx } from '../../../platform/tx.ts';
import { appendAudit } from '../../audit/index.ts';
import { principals, roleBindings, teamMembers, teams, users } from '../infra/schema.ts';
import { authorize } from './authorize.ts';

export interface UserDto {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  email: string | null;
  status: 'active' | 'disabled';
}

export interface TeamDto {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
}

export interface RoleBindingDto {
  id: string;
  subject: { userId: string } | { teamId: string };
  role: 'owner' | 'admin' | 'operator' | 'viewer';
  scope: { org: true } | { agentGroupId: string } | { agentId: string };
  createdAt: string;
}

const teamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
});
const memberSchema = z.object({ teamId: z.uuid(), userId: z.uuid() });
const bindingSchema = z.object({
  subject: z.union([z.object({ userId: z.uuid() }).strict(), z.object({ teamId: z.uuid() }).strict()]),
  role: z.enum(['owner', 'admin', 'operator', 'viewer']),
  scope: z.union([
    z.object({ org: z.literal(true) }).strict(),
    z.object({ agentGroupId: z.uuid() }).strict(),
    z.object({ agentId: z.uuid() }).strict(),
  ]),
});
const idSchema = z.object({ id: z.uuid() });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw invalid(r.error.issues);
  return r.data;
}

function changed(tx: Tx, orgId: string, entity: string, id: string, change: string): Promise<void> {
  return publish(tx, 'org.changed', { orgId, entity, id, change });
}

function bindingToDto(r: typeof roleBindings.$inferSelect): RoleBindingDto {
  return {
    id: r.id,
    subject: r.subjectType === 'user' ? { userId: r.subjectId } : { teamId: r.subjectId },
    role: r.role,
    scope:
      r.scopeType === 'org'
        ? { org: true }
        : r.scopeType === 'agentGroup'
          ? { agentGroupId: r.scopeId ?? '' }
          : { agentId: r.scopeId ?? '' },
    createdAt: r.createdAt.toISOString(),
  };
}

async function listUsers(db: Db, actor: ActorContext): Promise<UserDto[]> {
  await authorize(db, actor, 'read', {});
  const rows = await db
    .select({
      id: principals.id,
      handle: principals.handle,
      displayName: principals.displayName,
      avatar: principals.avatar,
      email: users.email,
      status: users.status,
    })
    .from(users)
    .innerJoin(principals, eq(principals.id, users.principalId))
    .where(eq(users.orgId, actor.orgId))
    .orderBy(asc(principals.handle));
  return rows;
}

async function listTeams(db: Db, actor: ActorContext): Promise<TeamDto[]> {
  await authorize(db, actor, 'read', {});
  const [teamRows, memberRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.orgId, actor.orgId)).orderBy(asc(teams.name)),
    db.select().from(teamMembers).where(eq(teamMembers.orgId, actor.orgId)),
  ]);
  return teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    memberIds: memberRows.filter((m) => m.teamId === t.id).map((m) => m.userId),
  }));
}

async function createTeam(db: Db, actor: ActorContext, input: unknown): Promise<TeamDto> {
  const data = parse(teamSchema, input);
  await authorize(db, actor, 'org.manage', {});
  return withTx(db, async (tx) => {
    const dup = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.orgId, actor.orgId), eq(teams.name, data.name)));
    if (dup.length > 0) throw conflict('team_exists', `team ${data.name} already exists`);
    const rows = await tx
      .insert(teams)
      .values({ orgId: actor.orgId, name: data.name, description: data.description })
      .returning();
    const team = rows[0];
    if (!team) throw new Error('team insert returned no row');
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'team.create',
      targetType: 'team',
      targetId: team.id,
      data: { name: team.name },
    });
    await changed(tx, actor.orgId, 'team', team.id, 'created');
    return { id: team.id, name: team.name, description: team.description, memberIds: [] };
  });
}

async function addTeamMember(db: Db, actor: ActorContext, input: unknown): Promise<void> {
  const data = parse(memberSchema, input);
  await authorize(db, actor, 'org.manage', {});
  await withTx(db, async (tx) => {
    const team = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.orgId, actor.orgId), eq(teams.id, data.teamId)));
    if (team.length === 0) throw notFound('team');
    const user = await tx
      .select({ id: users.principalId })
      .from(users)
      .where(and(eq(users.orgId, actor.orgId), eq(users.principalId, data.userId)));
    if (user.length === 0) throw notFound('user');
    const existing = await tx
      .select({ id: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, data.userId)));
    if (existing.length > 0) throw conflict('already_member', 'user is already a team member');
    await tx.insert(teamMembers).values({ teamId: data.teamId, userId: data.userId, orgId: actor.orgId });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'team.member.add',
      targetType: 'team',
      targetId: data.teamId,
      data: { userId: data.userId },
    });
    await changed(tx, actor.orgId, 'team', data.teamId, 'member_added');
  });
}

async function listRoleBindings(db: Db, actor: ActorContext): Promise<RoleBindingDto[]> {
  await authorize(db, actor, 'read', {});
  const rows = await db
    .select()
    .from(roleBindings)
    .where(eq(roleBindings.orgId, actor.orgId))
    .orderBy(asc(roleBindings.createdAt));
  return rows.map(bindingToDto);
}

async function createRoleBinding(db: Db, actor: ActorContext, input: unknown): Promise<RoleBindingDto> {
  const data = parse(bindingSchema, input);
  await authorize(db, actor, 'org.manage', {});
  return withTx(db, async (tx) => {
    const isUser = 'userId' in data.subject;
    const subjectId = 'userId' in data.subject ? data.subject.userId : data.subject.teamId;
    const subject = isUser
      ? await tx
          .select({ id: users.principalId })
          .from(users)
          .where(and(eq(users.orgId, actor.orgId), eq(users.principalId, subjectId)))
      : await tx
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.orgId, actor.orgId), eq(teams.id, subjectId)));
    if (subject.length === 0) throw notFound(isUser ? 'user' : 'team');
    const scope = data.scope;
    const rows = await tx
      .insert(roleBindings)
      .values({
        orgId: actor.orgId,
        subjectType: isUser ? 'user' : 'team',
        subjectId,
        role: data.role,
        scopeType: 'org' in scope ? 'org' : 'agentGroupId' in scope ? 'agentGroup' : 'agent',
        scopeId: 'agentGroupId' in scope ? scope.agentGroupId : 'agentId' in scope ? scope.agentId : null,
        createdBy: actor.principalId,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('role binding insert returned no row');
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'role_binding.create',
      targetType: 'role_binding',
      targetId: row.id,
      data: { subject: data.subject, role: data.role, scope: data.scope },
    });
    await changed(tx, actor.orgId, 'role_binding', row.id, 'created');
    return bindingToDto(row);
  });
}

async function deleteRoleBinding(db: Db, actor: ActorContext, input: unknown): Promise<void> {
  const { id } = parse(idSchema, input);
  await authorize(db, actor, 'org.manage', {});
  await withTx(db, async (tx) => {
    const rows = await tx
      .select()
      .from(roleBindings)
      .where(and(eq(roleBindings.orgId, actor.orgId), eq(roleBindings.id, id)));
    const row = rows[0];
    if (!row) throw notFound('role binding');
    if (row.role === 'owner' && row.scopeType === 'org') {
      const owners = await tx
        .select({ id: roleBindings.id })
        .from(roleBindings)
        .where(
          and(
            eq(roleBindings.orgId, actor.orgId),
            eq(roleBindings.role, 'owner'),
            eq(roleBindings.scopeType, 'org'),
          ),
        );
      if (owners.length <= 1) throw conflict('last_owner', 'cannot delete the last org owner binding');
    }
    await tx.delete(roleBindings).where(eq(roleBindings.id, id));
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action: 'role_binding.delete',
      targetType: 'role_binding',
      targetId: id,
      data: bindingToDto(row),
    });
    await changed(tx, actor.orgId, 'role_binding', id, 'deleted');
  });
}

export interface PrincipalDto {
  id: string;
  kind: 'user' | 'agent' | 'system';
  handle: string;
  displayName: string;
  avatar: string | null;
  createdAt: string;
}

function principalToDto(r: typeof principals.$inferSelect): PrincipalDto {
  return {
    id: r.id,
    kind: r.kind,
    handle: r.handle,
    displayName: r.displayName,
    avatar: r.avatar,
    createdAt: r.createdAt.toISOString(),
  };
}

async function listPrincipals(
  db: Db,
  actor: ActorContext,
  filter: { kind?: PrincipalDto['kind'] } = {},
): Promise<PrincipalDto[]> {
  await authorize(db, actor, 'read', {});
  const rows = await db
    .select()
    .from(principals)
    .where(and(eq(principals.orgId, actor.orgId), filter.kind ? eq(principals.kind, filter.kind) : undefined))
    .orderBy(asc(principals.handle));
  return rows.map(principalToDto);
}

async function getPrincipal(db: Db, actor: ActorContext, id: string): Promise<PrincipalDto> {
  await authorize(db, actor, 'read', {});
  const rows = await db
    .select()
    .from(principals)
    .where(and(eq(principals.orgId, actor.orgId), eq(principals.id, id)));
  const row = rows[0];
  if (!row) throw notFound('principal');
  return principalToDto(row);
}

export const orgUseCases = {
  listPrincipals,
  getPrincipal,
  listUsers,
  listTeams,
  createTeam,
  addTeamMember,
  createRoleBinding,
  deleteRoleBinding,
  listRoleBindings,
};
