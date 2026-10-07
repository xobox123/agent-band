import type {
  AccountDto,
  AgentDto,
  AgentGroupDto,
  AgentStatus,
  RunDto,
  TaskDto,
  TaskTarget as TaskTargetDto,
} from '@agent-band/contracts';
import type { Account, Agent, AgentGroup, AvatarSpec, Priority, Run, Task, TaskTarget } from './types.ts';

/** Accepts structured agent avatars and legacy user avatar strings. */
export function parseAvatar(
  value: string | import('@agent-band/contracts').AgentAvatar | null,
): AvatarSpec | null {
  if (!value) return null;
  if (typeof value !== 'string') return { [value.kind]: value.value };
  if (/^https?:\/\//.test(value)) return { url: value };
  if (/^av-\d+$/.test(value)) return { color: value };
  return { initials: value.slice(0, 3) };
}

export function toTarget(target: TaskTargetDto): TaskTarget {
  if ('agentId' in target) return { type: 'agent', agentId: target.agentId };
  if ('label' in target) return { type: 'label', label: target.label };
  return { type: 'group', agentGroupId: target.agentGroupId };
}

export function toTargetDto(target: TaskTarget): TaskTargetDto {
  if (target.type === 'agent') return { agentId: target.agentId };
  if (target.type === 'label') return { label: target.label };
  return { agentGroupId: target.agentGroupId };
}

export function toTask(dto: TaskDto, runId: string | null): Task {
  return {
    id: dto.id,
    key: dto.key,
    title: dto.title,
    prompt: dto.prompt,
    status: dto.status,
    priority: dto.priority as Priority,
    rank: dto.rank,
    target: toTarget(dto.target),
    workDir: dto.workDir,
    mode: dto.mode,
    kind: dto.kind,
    parentTaskId: dto.parentTaskId,
    proposed: dto.proposed,
    dependsOn: dto.dependsOn,
    startAfterReset: dto.startAfterReset,
    runId,
    runAt: dto.runAt,
    scheduleId: dto.scheduleId,
    attempt: dto.attempt,
    maxAttempts: dto.maxAttempts,
    resumeAt: dto.resumeAt,
    error: dto.error,
    noEligibleReason: dto.status === 'queued' ? dto.eligibilityReason : null,
    createdBy: dto.createdBy,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

export function toRun(dto: RunDto): Run {
  return {
    id: dto.id,
    taskId: dto.taskId,
    agentId: dto.agentId,
    accountId: dto.accountId,
    status: dto.status,
    startedAt: dto.startedAt,
    finishedAt: dto.finishedAt,
    inputTokens: dto.inputTokens,
    outputTokens: dto.outputTokens,
    cachedTokens: dto.cachedTokens,
    rateLimitResetsAt: dto.rateLimitResetsAt,
    error: dto.error,
  };
}

export function toAgent(dto: AgentDto, status?: AgentStatus, runningRunId: string | null = null): Agent {
  return {
    id: dto.id,
    name: dto.name,
    handle: dto.handle,
    role: dto.role,
    enabled: dto.enabled,
    paused: dto.paused,
    accountId: dto.accountId,
    model: dto.model,
    labels: dto.labels,
    groupIds: dto.groupIds,
    avatar: parseAvatar(dto.avatar),
    status: status ?? (dto.enabled ? 'idle' : 'disabled'),
    runningRunId,
  };
}

export function toAccount(dto: AccountDto, tokensToday: number): Account {
  return {
    id: dto.id,
    name: dto.name,
    provider: dto.provider,
    dailyTokenBudget: dto.limits.dailyTokenBudget ?? null,
    tokensToday,
    paused: dto.paused,
  };
}

export function toGroup(dto: AgentGroupDto): AgentGroup {
  return { id: dto.id, name: dto.name };
}
