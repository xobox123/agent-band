/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitOut, makeRepo } from '../../modules/projects/git.testkit.ts';
import { tasks as tasksTable } from '../../modules/tasks/infra/schema.ts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
let repo: ReturnType<typeof makeRepo>;
beforeEach(async () => {
  api = await makeApi();
  repo = makeRepo();
});
afterEach(async () => {
  await api.close();
});

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await api.app.inject({ method, url: `/api/v1${url}`, payload: payload as object });
  return {
    status: res.statusCode,
    json: () => (res.body ? (JSON.parse(res.body) as Record<string, any>) : {}),
  };
}

const createProject = (extra: Record<string, unknown> = {}) =>
  call('POST', '/projects', { name: 'Repo', repoPath: repo.dir, checks: ['echo ok'], ...extra });

/** A project whose worktrees folder lies outside the workspace root the baseline policy allows. */
const outsideProject = async () =>
  (await createProject({ worktreesRoot: join(repo.base, 'worktrees') })).json();

async function seedAgent() {
  const account = await call('POST', '/accounts', {
    name: 'acc',
    provider: 'claude',
    type: 'cli',
    configDir: '/tmp/acc',
  });
  const agent = await call('POST', '/agents', { slug: 'alpha', name: 'alpha', accountId: account.json().id });
  return agent.json();
}

describe('projects api', () => {
  it('creates, lists, reads and edits a project; the worktrees folder defaults under the workspace', async () => {
    const created = await createProject();
    expect(created.status).toBe(201);
    const body = created.json();
    const ws = (await call('GET', '/organization')).json().workspaceRoot;
    expect(body).toMatchObject({
      name: 'Repo',
      slug: 'repo',
      repoPath: repo.dir,
      defaultBranch: 'main',
      worktreesRoot: join(ws, 'repo', 'worktrees'),
      checks: ['echo ok'],
      keepWorktrees: false,
    });
    expect((await call('GET', '/projects')).json().items).toHaveLength(1);
    expect((await call('GET', `/projects/${body.id}`)).json().id).toBe(body.id);
    const patched = await call('PATCH', `/projects/${body.id}`, {
      checks: ['npm test'],
      keepWorktrees: true,
    });
    expect(patched.json()).toMatchObject({ checks: ['npm test'], keepWorktrees: true });
    expect((await call('PATCH', `/projects/${body.id}`, {})).status).toBe(400);
    expect((await call('GET', '/projects/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('validates a repository path without creating anything', async () => {
    const ok = await call('GET', `/projects/validate?path=${encodeURIComponent(repo.dir)}`);
    expect(ok.json()).toEqual({ valid: true, defaultBranch: 'main', reason: null });
    const bad = await call('GET', `/projects/validate?path=${encodeURIComponent(repo.base)}`);
    expect(bad.json()).toMatchObject({ valid: false, defaultBranch: null, reason: 'not a git repository' });
    const created = await createProject({ repoPath: repo.base });
    expect(created.status).toBe(400);
    expect(created.json().details[0].path).toBe('repoPath');
    expect((await call('GET', '/projects')).json().items).toHaveLength(0);
  });

  it('lets viewers and operators read but only admins manage projects', async () => {
    await createProject();
    const operator = await api.makeUser('olga', 'operator');
    const viewer = await api.makeUser('victor', 'viewer');
    api.as(operator);
    expect((await call('GET', '/projects')).status).toBe(200);
    expect((await createProject({ name: 'Other' })).status).toBe(403);
    api.as(viewer);
    expect((await call('GET', '/projects')).status).toBe(200);
    api.as(await api.makeUser('anna', 'admin'));
    expect((await createProject({ name: 'Other' })).status).toBe(201);
  });

  it('adds the worktrees folder to a policy once and audits it', async () => {
    const project = await outsideProject();
    const policy = (await call('GET', '/policies')).json().items[0];
    const first = await call('POST', `/projects/${project.id}/allow-agents`, { policyId: policy.id });
    expect(first.json()).toMatchObject({ policyId: policy.id, added: true });
    expect(first.json().workDirs).toContain(project.worktreesRoot);
    const second = await call('POST', `/projects/${project.id}/allow-agents`, { policyId: policy.id });
    expect(second.json().added).toBe(false);
    const detail = (await call('GET', `/policies/${policy.id}`)).json();
    expect(detail.rules.workDirs.filter((d: string) => d === project.worktreesRoot)).toHaveLength(1);
    const actions = (await call('GET', '/audit?limit=200')).json().items.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['project.create', 'project.allow_agents']));
  });

  it('creates project tasks only where agents may work, then reviews and merges them', async () => {
    const project = await outsideProject();
    const agent = await seedAgent();
    const payload = { title: 'T', prompt: 'p', target: { agentId: agent.id }, projectId: project.id };
    const denied = await call('POST', '/tasks', payload);
    expect(denied.status).toBe(422);
    expect(denied.json().code).toBe('work_dir_outside_policy');
    const policy = (await call('GET', '/policies')).json().items[0];
    await call('POST', `/projects/${project.id}/allow-agents`, { policyId: policy.id });
    const created = await call('POST', '/tasks', payload);
    expect(created.status).toBe(201);
    const task = created.json();
    expect(task).toMatchObject({
      projectId: project.id,
      branch: `ab/${task.key}`,
      baseBranch: 'main',
      workDir: join(project.worktreesRoot, task.key),
      review: null,
    });
    expect((await call('GET', `/tasks/${task.id}/diff`)).status).toBe(409);
    expect((await call('GET', `/tasks?projectId=${project.id}`)).json().items).toHaveLength(1);
    expect(
      (await call('GET', '/tasks?projectId=00000000-0000-4000-8000-000000000000')).json().items,
    ).toHaveLength(0);

    const row = await api.c.tasks.getTask(api.database.db, api.c.localUser, task.id);
    await api.c.projectRuns.prepare(api.database.db, row);
    writeFileSync(join(row.workDir, 'a.txt'), 'a\n');
    const review = await api.c.projectRuns.finalize(api.database.db, row, {
      name: 'Alpha',
      email: 'a@x.test',
    });
    await api.database.db.update(tasksTable).set({ status: 'done' }).where(eq(tasksTable.id, task.id));
    await api.database.db.transaction((tx) => api.c.tasks.setReview(tx, api.c.localUser, task.id, review));

    const shown = (await call('GET', `/tasks/${task.id}`)).json();
    expect(shown.review).toMatchObject({ status: 'pending', diffStat: { files: 1, additions: 1 } });
    const diff = (await call('GET', `/tasks/${task.id}/diff`)).json();
    expect(diff).toMatchObject({ truncated: false, files: [{ path: 'a.txt', additions: 1, deletions: 0 }] });
    expect(diff.diff).toContain('+a');

    const operator = await api.makeUser('olga', 'operator');
    api.as(operator);
    expect((await call('POST', `/tasks/${task.id}/review/approve`)).status).toBe(403);
    api.as(null);
    const approved = await call('POST', `/tasks/${task.id}/review/approve`);
    expect(approved.status).toBe(200);
    expect(approved.json().review.status).toBe('merged');
    expect(gitOut(repo.dir, 'log', '--merges', '--format=%s')).toBe(`Merge ${task.key}: T`);
    expect(existsSync(row.workDir)).toBe(false);
  });

  it('rejects with feedback through the api and validates the body', async () => {
    const project = await outsideProject();
    const agent = await seedAgent();
    const policy = (await call('GET', '/policies')).json().items[0];
    await call('POST', `/projects/${project.id}/allow-agents`, { policyId: policy.id });
    const task = (
      await call('POST', '/tasks', {
        title: 'T',
        prompt: 'p',
        target: { agentId: agent.id },
        projectId: project.id,
      })
    ).json();
    expect((await call('POST', `/tasks/${task.id}/review/reject`, { feedback: '' })).status).toBe(400);
    expect((await call('POST', `/tasks/${task.id}/review/reject`, { feedback: 'x' })).status).toBe(409);
    expect((await call('POST', `/tasks/${task.id}/review/request`, {})).status).toBe(409);
  });

  it('removes the worktree and branch of a cancelled queued project task', async () => {
    const project = await outsideProject();
    const agent = await seedAgent();
    const policy = (await call('GET', '/policies')).json().items[0];
    await call('POST', `/projects/${project.id}/allow-agents`, { policyId: policy.id });
    const task = (
      await call('POST', '/tasks', {
        title: 'T',
        prompt: 'p',
        target: { agentId: agent.id },
        projectId: project.id,
        draft: true,
      })
    ).json();
    const row = await api.c.tasks.getTask(api.database.db, api.c.localUser, task.id);
    await api.c.projectRuns.prepare(api.database.db, row);
    await api.database.db.update(tasksTable).set({ status: 'queued' }).where(eq(tasksTable.id, task.id));
    expect(existsSync(row.workDir)).toBe(true);
    expect((await call('POST', `/tasks/${task.id}/cancel`)).status).toBe(200);
    expect(existsSync(row.workDir)).toBe(false);
    expect(gitOut(repo.dir, 'branch', '--format=%(refname:short)')).toBe('main');
  });
});
