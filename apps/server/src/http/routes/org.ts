import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AddTeamMemberBody,
  CreateRoleBindingBody,
  CreateTeamBody,
  IdParams,
  OrganizationDto,
  PrincipalDto,
  PrincipalList,
  PrincipalQuery,
  RoleBindingDto,
  RoleBindingList,
  SetOrgPolicyBody,
  TeamDto,
  TeamList,
  TeamParams,
  UpdateOrganizationBody,
  UserList,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { requirePolicy } from '../guards.ts';
import { getOrganization, setOrgPolicy, updateOrganization } from '../../modules/org/index.ts';

export function orgRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  return (app, _opts, done) => {
    app.get(
      '/organization',
      { schema: { tags: ['org'], summary: 'Get the organization', response: { 200: OrganizationDto } } },
      async (req) => {
        const actor = await c.resolveActor(req);
        await c.ports.authorizer.authorize(db, actor, 'read', {});
        return getOrganization(db, actor.orgId);
      },
    );

    app.patch(
      '/organization',
      {
        schema: {
          tags: ['org'],
          summary: 'Update the organization',
          body: UpdateOrganizationBody,
          response: { 200: OrganizationDto },
        },
      },
      async (req) => updateOrganization(db, await c.resolveActor(req), req.body),
    );

    app.put(
      '/organization/policy',
      {
        schema: {
          tags: ['org'],
          summary: 'Set the organization baseline policy',
          body: SetOrgPolicyBody,
          response: { 200: OrganizationDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        await requirePolicy(c, actor.orgId, req.body.policyId);
        return setOrgPolicy(db, actor, req.body);
      },
    );

    app.get(
      '/users',
      { schema: { tags: ['org'], summary: 'List users', response: { 200: UserList } } },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.org.listUsers(db, await c.resolveActor(req)), cursor };
      },
    );

    app.get(
      '/teams',
      { schema: { tags: ['org'], summary: 'List teams', response: { 200: TeamList } } },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.org.listTeams(db, await c.resolveActor(req)), cursor };
      },
    );

    app.post(
      '/teams',
      {
        schema: { tags: ['org'], summary: 'Create a team', body: CreateTeamBody, response: { 201: TeamDto } },
      },
      async (req, reply) => {
        const team = await c.org.createTeam(db, await c.resolveActor(req), req.body);
        return reply.code(201).send(team);
      },
    );

    app.post(
      '/teams/:teamId/members',
      {
        schema: {
          tags: ['org'],
          summary: 'Add a user to a team',
          params: TeamParams,
          body: AddTeamMemberBody,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.org.addTeamMember(db, await c.resolveActor(req), {
          teamId: req.params.teamId,
          userId: req.body.userId,
        });
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/role-bindings',
      { schema: { tags: ['org'], summary: 'List role bindings', response: { 200: RoleBindingList } } },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.org.listRoleBindings(db, await c.resolveActor(req)), cursor };
      },
    );

    app.post(
      '/role-bindings',
      {
        schema: {
          tags: ['org'],
          summary: 'Create a role binding',
          body: CreateRoleBindingBody,
          response: { 201: RoleBindingDto },
        },
      },
      async (req, reply) => {
        const binding = await c.org.createRoleBinding(db, await c.resolveActor(req), req.body);
        return reply.code(201).send(binding);
      },
    );

    app.delete(
      '/role-bindings/:id',
      {
        schema: {
          tags: ['org'],
          summary: 'Delete a role binding',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.org.deleteRoleBinding(db, await c.resolveActor(req), { id: req.params.id });
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/principals',
      {
        schema: {
          tags: ['principals'],
          summary: 'List principals',
          querystring: PrincipalQuery,
          response: { 200: PrincipalList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.org.listPrincipals(db, await c.resolveActor(req), req.query), cursor };
      },
    );

    app.get(
      '/principals/:id',
      {
        schema: {
          tags: ['principals'],
          summary: 'Get a principal',
          params: IdParams,
          response: { 200: PrincipalDto },
        },
      },
      async (req) => c.org.getPrincipal(db, await c.resolveActor(req), req.params.id),
    );

    app.get(
      '/me',
      { schema: { tags: ['principals'], summary: 'The acting principal', response: { 200: PrincipalDto } } },
      async (req) => {
        const actor = await c.resolveActor(req);
        return c.org.getPrincipal(db, actor, actor.principalId);
      },
    );
    done();
  };
}
