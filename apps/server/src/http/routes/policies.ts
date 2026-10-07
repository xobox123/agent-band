import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AssignSkillBody,
  CreatePolicyBody,
  EffectivePolicyDto,
  EffectiveSkillList,
  IdParams,
  ImportSkillBody,
  NewSkillVersionBody,
  PolicyDetailDto,
  PolicyList,
  SkillAssignmentDto,
  SkillAssignmentList,
  SkillAssignmentQuery,
  SkillDetailDto,
  SkillList,
  UpdatePolicyBody,
} from '@agent-band/contracts';
import { z } from 'zod';
import { describePolicy } from '../../modules/policy/index.ts';
import type { Composition } from '../../composition.ts';

export function policyRoutes(c: Composition): FastifyPluginCallbackZod {
  return (app, _opts, done) => {
    app.get(
      '/policies',
      { schema: { tags: ['policies'], summary: 'List policies', response: { 200: PolicyList } } },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.policies.list(await c.resolveActor(req)), cursor };
      },
    );

    app.post(
      '/policies',
      {
        schema: {
          tags: ['policies'],
          summary: 'Create a policy (version 1)',
          body: CreatePolicyBody,
          response: { 201: PolicyDetailDto },
        },
      },
      async (req, reply) => {
        const policy = await c.policies.create(await c.resolveActor(req), req.body);
        return reply.code(201).send(policy);
      },
    );

    app.get(
      '/policies/:id',
      {
        schema: {
          tags: ['policies'],
          summary: 'Get a policy with its versions',
          params: IdParams,
          response: { 200: PolicyDetailDto },
        },
      },
      async (req) => c.policies.get(await c.resolveActor(req), req.params.id),
    );

    app.patch(
      '/policies/:id',
      {
        schema: {
          tags: ['policies'],
          summary: 'Update name, description or rules (rules create a new version)',
          params: IdParams,
          body: UpdatePolicyBody,
          response: { 200: PolicyDetailDto },
        },
      },
      async (req) => c.policies.update(await c.resolveActor(req), req.params.id, req.body),
    );

    app.get(
      '/agents/:id/effective-policy',
      {
        schema: {
          tags: ['policies'],
          summary: 'Merged policy of org, groups and agent with sources',
          params: IdParams,
          response: { 200: EffectivePolicyDto },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const agent = await c.agents.getAgent(c.database.db, actor, req.params.id);
        const account = await c.accounts.getAccount(c.database.db, actor, agent.accountId);
        const provider = c.listProviders().find((p) => p.id === account.provider);
        if (!provider) throw new Error('Account provider is not registered');
        return describePolicy(await c.policies.effectiveFor(actor.orgId, req.params.id), provider);
      },
    );

    app.get(
      '/skills',
      { schema: { tags: ['skills'], summary: 'List skills', response: { 200: SkillList } } },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.skills.list(await c.resolveActor(req)), cursor };
      },
    );

    app.post(
      '/skills',
      {
        schema: {
          tags: ['skills'],
          summary: 'Import a skill from a files map or a base64 zip',
          body: ImportSkillBody,
          response: { 201: SkillDetailDto },
        },
      },
      async (req, reply) => {
        const skill = await c.skills.import(await c.resolveActor(req), req.body);
        return reply.code(201).send(skill);
      },
    );

    app.get(
      '/skills/:id',
      {
        schema: {
          tags: ['skills'],
          summary: 'Get a skill with its versions',
          params: IdParams,
          response: { 200: SkillDetailDto },
        },
      },
      async (req) => c.skills.get(await c.resolveActor(req), req.params.id),
    );

    app.post(
      '/skills/:id/versions',
      {
        schema: {
          tags: ['skills'],
          summary: 'Add a new skill version',
          params: IdParams,
          body: NewSkillVersionBody,
          response: { 201: SkillDetailDto },
        },
      },
      async (req, reply) => {
        const skill = await c.skills.newVersion(await c.resolveActor(req), req.params.id, req.body);
        return reply.code(201).send(skill);
      },
    );

    app.get(
      '/skill-assignments',
      {
        schema: {
          tags: ['skills'],
          summary: 'List skill assignments',
          querystring: SkillAssignmentQuery,
          response: { 200: SkillAssignmentList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.skills.listAssignments(await c.resolveActor(req), req.query), cursor };
      },
    );

    app.post(
      '/skill-assignments',
      {
        schema: {
          tags: ['skills'],
          summary: 'Assign a skill to the org, a group or an agent',
          body: AssignSkillBody,
          response: { 201: SkillAssignmentDto },
        },
      },
      async (req, reply) => {
        const assignment = await c.skills.assign(await c.resolveActor(req), req.body);
        return reply.code(201).send(assignment);
      },
    );

    app.delete(
      '/skill-assignments/:id',
      {
        schema: {
          tags: ['skills'],
          summary: 'Remove a skill assignment',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.skills.unassign(await c.resolveActor(req), req.params.id);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/agents/:id/effective-skills',
      {
        schema: {
          tags: ['skills'],
          summary: 'Skills in effect for an agent (org, groups, agent)',
          params: IdParams,
          response: { 200: EffectiveSkillList },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const cursor = await c.cursor();
        await c.agents.getAgent(c.database.db, actor, req.params.id);
        const [skills, policy] = await Promise.all([
          c.skills.effectiveFor(actor.orgId, req.params.id),
          c.policies.effectiveFor(actor.orgId, req.params.id),
        ]);
        const allowed = (id: string) =>
          policy.allowedSkillIds === undefined || policy.allowedSkillIds.includes(id);
        return {
          items: skills.filter((s) => allowed(s.skillId)),
          excluded: skills
            .filter((s) => !allowed(s.skillId))
            .map((s) => ({ ...s, reason: 'allowedSkillIds' as const })),
          cursor,
        };
      },
    );
    done();
  };
}
