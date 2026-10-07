import { and, asc, eq } from 'drizzle-orm';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActorContext } from '../../../platform/actor.ts';
import type { Db } from '../../../platform/db.ts';
import { conflict, invalid, notFound } from '../../../platform/errors.ts';
import { publish } from '../../../platform/outbox.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { DbOrTx, ModuleDeps, OrgSettings, ProjectLookup } from '../../../ports/index.ts';
import {
  CreateProject,
  UpdateProject,
  slugOf,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '../domain/project.ts';
import { inspectRepo, type RepoInspection } from '../infra/git.ts';
import { projects, type Project } from '../infra/schema.ts';

export type ProjectsDeps = ModuleDeps & { orgSettings: OrgSettings };

export function createProjects(deps: ProjectsDeps) {
  const where = (orgId: string, id: string) => and(eq(projects.orgId, orgId), eq(projects.id, id));

  async function row(db: DbOrTx, orgId: string, id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(where(orgId, id));
    return project;
  }
  async function audit(tx: Tx, actor: ActorContext, action: string, id: string, data?: unknown) {
    await deps.audit.append(tx, {
      orgId: actor.orgId,
      actorId: actor.principalId,
      action,
      targetType: 'project',
      targetId: id,
      data,
    });
    await publish(tx, 'project.updated', { orgId: actor.orgId, projectId: id });
  }

  const lookup: ProjectLookup = { get: row };

  return {
    lookup,
    row,
    async validateRepo(db: Db, actor: ActorContext, path: string): Promise<RepoInspection> {
      await deps.authorizer.authorize(db, actor, 'agent.manage', {});
      return inspectRepo(path);
    },
    async create(db: Db, actor: ActorContext, input: CreateProjectInput): Promise<Project> {
      const parsed = CreateProject.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues);
      const v = parsed.data;
      await deps.authorizer.authorize(db, actor, 'agent.manage', {});
      const repo = await inspectRepo(v.repoPath);
      if (!repo.valid) throw invalid([{ path: 'repoPath', message: `${v.repoPath}: ${repo.reason}` }]);
      const settings = await deps.orgSettings.get(db, actor.orgId);
      const base = v.slug ?? slugOf(v.name);
      return db.transaction(async (tx) => {
        const taken = new Set(
          (
            await tx.select({ slug: projects.slug }).from(projects).where(eq(projects.orgId, actor.orgId))
          ).map((p) => p.slug),
        );
        if (v.slug && taken.has(v.slug)) throw conflict('project_slug_taken', `Slug ${v.slug} is taken`);
        let slug = base;
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
        const worktreesRoot = v.worktreesRoot ?? join(settings.workspaceRoot, slug, 'worktrees');
        await mkdir(worktreesRoot, { recursive: true, mode: 0o700 });
        const [project] = await tx
          .insert(projects)
          .values({
            orgId: actor.orgId,
            name: v.name,
            slug,
            repoPath: repo.root,
            defaultBranch: repo.defaultBranch,
            worktreesRoot,
            checks: v.checks,
            keepWorktrees: v.keepWorktrees,
            createdBy: actor.principalId,
          })
          .returning();
        if (!project) throw new Error('Missing inserted project');
        await audit(tx, actor, 'project.create', project.id, { repoPath: repo.root });
        return project;
      });
    },
    async list(db: Db, actor: ActorContext): Promise<Project[]> {
      await deps.authorizer.authorize(db, actor, 'read', {});
      return db
        .select()
        .from(projects)
        .where(eq(projects.orgId, actor.orgId))
        .orderBy(asc(projects.name), asc(projects.id));
    },
    async get(db: Db, actor: ActorContext, id: string): Promise<Project> {
      await deps.authorizer.authorize(db, actor, 'read', {});
      const project = await row(db, actor.orgId, id);
      if (!project) throw notFound('project');
      return project;
    },
    async update(db: Db, actor: ActorContext, id: string, input: UpdateProjectInput): Promise<Project> {
      const parsed = UpdateProject.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues);
      await deps.authorizer.authorize(db, actor, 'agent.manage', {});
      return db.transaction(async (tx) => {
        const [project] = await tx
          .update(projects)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(where(actor.orgId, id))
          .returning();
        if (!project) throw notFound('project');
        await audit(tx, actor, 'project.update', id, parsed.data);
        return project;
      });
    },
    /** Records that the worktrees folder was added to a policy; the policy change itself is made by the caller. */
    async recordAllowed(db: Db, actor: ActorContext, id: string, policyId: string): Promise<void> {
      await db.transaction(async (tx) => {
        await audit(tx, actor, 'project.allow_agents', id, { policyId });
      });
    },
  };
}

export type Projects = ReturnType<typeof createProjects>;
