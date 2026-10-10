import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AllowProjectBody,
  CreateProjectBody,
  IdParams,
  ProjectDto,
  ProjectList,
  UpdateProjectBody,
  ValidateRepoDto,
  ValidateRepoQuery,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { projectDto } from '../dto.ts';

export function projectRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  return (app, _opts, done) => {
    app.get(
      '/projects',
      { schema: { tags: ['projects'], summary: 'List projects', response: { 200: ProjectList } } },
      async (req) => {
        const cursor = await c.cursor();
        const items = await c.projects.list(db, await c.resolveActor(req));
        return { items: items.map(projectDto), cursor };
      },
    );

    app.get(
      '/projects/validate',
      {
        schema: {
          tags: ['projects'],
          summary: 'Check that a path is a git repository and detect its default branch',
          querystring: ValidateRepoQuery,
          response: { 200: ValidateRepoDto },
        },
      },
      async (req) => {
        const result = await c.projects.validateRepo(db, await c.resolveActor(req), req.query.path);
        return result.valid
          ? { valid: true, defaultBranch: result.defaultBranch, reason: null }
          : { valid: false, defaultBranch: null, reason: result.reason };
      },
    );

    app.post(
      '/projects',
      {
        schema: {
          tags: ['projects'],
          summary: 'Create a project for a git repository',
          body: CreateProjectBody,
          response: { 201: ProjectDto },
        },
      },
      async (req, reply) =>
        reply.code(201).send(projectDto(await c.projects.create(db, await c.resolveActor(req), req.body))),
    );

    app.get(
      '/projects/:id',
      {
        schema: {
          tags: ['projects'],
          summary: 'Get a project',
          params: IdParams,
          response: { 200: ProjectDto },
        },
      },
      async (req) => projectDto(await c.projects.get(db, await c.resolveActor(req), req.params.id)),
    );

    app.patch(
      '/projects/:id',
      {
        schema: {
          tags: ['projects'],
          summary: 'Edit the name, checks or worktree retention of a project',
          params: IdParams,
          body: UpdateProjectBody,
          response: { 200: ProjectDto },
        },
      },
      async (req) =>
        projectDto(await c.projects.update(db, await c.resolveActor(req), req.params.id, req.body)),
    );

    app.post(
      '/projects/:id/allow-agents',
      {
        schema: {
          tags: ['projects'],
          summary: 'Add the worktrees folder of a project to the allowed directories of a policy',
          params: IdParams,
          body: AllowProjectBody,
          response: {
            200: z.object({ policyId: z.uuid(), added: z.boolean(), workDirs: z.array(z.string()) }),
          },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        const project = await c.projects.get(db, actor, req.params.id);
        const policy = await c.policies.get(actor, req.body.policyId);
        const dirs = policy.rules.workDirs;
        // A policy without a directory list does not restrict directories; adding one would restrict it.
        const added = dirs !== undefined && !dirs.includes(project.worktreesRoot);
        const workDirs = added ? [...dirs, project.worktreesRoot] : (dirs ?? []);
        if (added) await c.policies.update(actor, policy.id, { rules: { ...policy.rules, workDirs } });
        await c.projects.recordAllowed(db, actor, project.id, policy.id);
        return { policyId: policy.id, added, workDirs };
      },
    );
    done();
  };
}
