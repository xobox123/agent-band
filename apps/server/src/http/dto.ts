import type {
  GoalStateDto,
  ProjectDto,
  RunDto,
  RunEventDto,
  ScheduleDto,
  TaskDto,
} from '@agent-band/contracts';
import type { Project } from '../modules/projects/index.ts';
import type { Run, RunEvent } from '../modules/runs/index.ts';
import type { Schedule } from '../modules/scheduler/index.ts';
import type { GoalState, Task } from '../modules/tasks/index.ts';

export function taskDto(t: Task): TaskDto {
  return {
    id: t.id,
    orgId: t.orgId,
    key: t.key,
    title: t.title,
    prompt: t.prompt,
    workDir: t.workDir,
    target: t.target,
    priority: t.priority,
    rank: t.rank,
    mode: t.mode,
    status: t.status,
    runAt: t.runAt?.toISOString() ?? null,
    scheduleId: t.scheduleId,
    attempt: t.attempt,
    maxAttempts: t.maxAttempts,
    resumeAt: t.resumeAt?.toISOString() ?? null,
    workerId: t.workerId,
    error: t.error,
    kind: t.kind,
    parentTaskId: t.parentTaskId,
    rootTaskId: t.rootTaskId,
    depth: t.depth,
    dependsOn: t.dependsOn,
    proposed: t.proposed,
    startAfterReset: t.startAfterReset,
    result: t.result,
    latestRun: null,
    eligibilityReason: t.eligibility?.reason ?? null,
    runCount: 0,
    projectId: t.projectId,
    branch: t.branch,
    baseBranch: t.baseBranch,
    review: t.review,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function projectDto(p: Project): ProjectDto {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    slug: p.slug,
    repoPath: p.repoPath,
    defaultBranch: p.defaultBranch,
    worktreesRoot: p.worktreesRoot,
    checks: p.checks,
    keepWorktrees: p.keepWorktrees,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function goalDto(g: GoalState, treeTokensUsed = g.treeTokensUsed): GoalStateDto {
  return {
    rootTaskId: g.rootTaskId,
    orgId: g.orgId,
    round: g.round,
    leaderAgentId: g.leaderAgentId,
    status: g.status,
    approval: g.approval,
    treeTokensUsed,
    limits: g.limits,
    summary: g.summary,
    outcome: g.outcome,
    reason: g.reason,
    notes: g.notes,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

export function runDto(r: Run): RunDto {
  return {
    id: r.id,
    orgId: r.orgId,
    taskId: r.taskId,
    agentId: r.agentId,
    accountId: r.accountId,
    workerId: r.workerId,
    effectivePolicy: r.effectivePolicy,
    skills: r.skills,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    exitCode: r.exitCode,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedTokens: r.cachedTokens,
    costUsd: r.costUsd,
    rateLimitResetsAt: r.rateLimitResetsAt?.toISOString() ?? null,
    error: r.error,
  };
}

export function runEventDto(e: RunEvent): RunEventDto {
  return { id: e.id, runId: e.runId, ts: e.ts.toISOString(), kind: e.kind, payload: e.payload };
}

export function scheduleDto(s: Schedule): ScheduleDto {
  return {
    id: s.id,
    orgId: s.orgId,
    name: s.name,
    enabled: s.enabled,
    cron: s.cron,
    timezone: s.timezone,
    template: s.template,
    overlap: s.overlap,
    lastFiredAt: s.lastFiredAt?.toISOString() ?? null,
    lastTaskId: s.lastTaskId,
    nextFireAt: s.nextFireAt.toISOString(),
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
