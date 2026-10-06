import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentDto,
  AgentGroupDto,
  AgentGroupList,
  AgentList,
  AgentQuery,
  CreateAgentBody,
  CreateGroupBody,
  GroupMemberParams,
  IdParams,
  UpdateAgentBody,
  UpdateGroupBody,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { requirePolicy } from '../guards.ts';

export function agentRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  return (app, _opts, done) => {
    app.get(
      '/agents',
      {
        schema: {
          tags: ['agents'],
          summary: 'List agents',
          querystring: AgentQuery,
          response: { 200: AgentList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.agents.listAgents(db, await c.resolveActor(req), req.query), cursor };
      },
    );

    app.post(
      '/agents',
      {
        schema: {
          tags: ['agents'],
          summary: 'Create an agent',
          body: CreateAgentBody,
          response: { 201: AgentDto },
        },
      },
      async (req, reply) => {
        const actor = await c.resolveActor(req);
        await requirePolicy(c, actor.orgId, req.body.policyId);
        const agent = await c.agents.createAgent(db, actor, req.body);
        return reply.code(201).send(agent);
      },
    );

    app.get(
      '/agents/:id',
      {
        schema: { tags: ['agents'], summary: 'Get an agent', params: IdParams, response: { 200: AgentDto } },
      },
      async (req) => c.agents.getAgent(db, await c.resolveActor(req), req.params.id),
    );

    app.patch(
      '/agents/:id',
      {
        schema: {
          tags: ['agents'],
          summary: 'Update an agent',
          params: IdParams,
          body: UpdateAgentBody,
          response: { 200: AgentDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        await requirePolicy(c, actor.orgId, req.body.policyId);
        return c.agents.updateAgent(db, actor, req.params.id, req.body);
      },
    );

    app.delete(
      '/agents/:id',
      {
        schema: {
          tags: ['agents'],
          summary: 'Delete (disable) an agent',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.agents.deleteAgent(db, await c.resolveActor(req), req.params.id);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/agent-groups',
      {
        schema: { tags: ['agent-groups'], summary: 'List agent groups', response: { 200: AgentGroupList } },
      },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.groups.listGroups(db, await c.resolveActor(req)), cursor };
      },
    );

    app.post(
      '/agent-groups',
      {
        schema: {
          tags: ['agent-groups'],
          summary: 'Create an agent group',
          body: CreateGroupBody,
          response: { 201: AgentGroupDto },
        },
      },
      async (req, reply) => {
        const actor = await c.resolveActor(req);
        await requirePolicy(c, actor.orgId, req.body.policyId);
        const group = await c.groups.createGroup(db, actor, req.body);
        return reply.code(201).send(group);
      },
    );

    app.patch(
      '/agent-groups/:id',
      {
        schema: {
          tags: ['agent-groups'],
          summary: 'Update an agent group',
          params: IdParams,
          body: UpdateGroupBody,
          response: { 200: AgentGroupDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        await requirePolicy(c, actor.orgId, req.body.policyId);
        return c.groups.updateGroup(db, actor, req.params.id, req.body);
      },
    );

    app.delete(
      '/agent-groups/:id',
      {
        schema: {
          tags: ['agent-groups'],
          summary: 'Delete an agent group',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.groups.deleteGroup(db, await c.resolveActor(req), req.params.id);
        return reply.code(204).send(null);
      },
    );

    app.put(
      '/agent-groups/:id/members/:agentId',
      {
        schema: {
          tags: ['agent-groups'],
          summary: 'Add an agent to a group',
          params: GroupMemberParams,
          response: { 200: AgentGroupDto },
        },
      },
      async (req) =>
        c.groups.addAgentToGroup(db, await c.resolveActor(req), req.params.id, req.params.agentId),
    );

    app.delete(
      '/agent-groups/:id/members/:agentId',
      {
        schema: {
          tags: ['agent-groups'],
          summary: 'Remove an agent from a group',
          params: GroupMemberParams,
          response: { 200: AgentGroupDto },
        },
      },
      async (req) =>
        c.groups.removeAgentFromGroup(db, await c.resolveActor(req), req.params.id, req.params.agentId),
    );
    done();
  };
}
