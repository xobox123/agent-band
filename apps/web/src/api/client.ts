import type {
  AccountDto,
  AgentDto,
  AgentGroupDto,
  AuditEventDto,
  AuditVerifyDto,
  BoardDto,
  CreateAccountBody,
  LoginResult,
  ModelList,
  ProbeConfigBody,
  ProbeResult,
  RefreshLimitsResult,
  CreateAgentBody,
  CreateGroupBody,
  CreatePolicyBody,
  CreateRoleBindingBody,
  CreateTaskBody,
  CreateTeamBody,
  AssignSkillBody,
  DashboardDto,
  EffectivePolicyDto,
  EffectiveSkillList,
  ImportSkillBody,
  NewSkillVersionBody,
  OrganizationDto,
  PolicyDetailDto,
  PolicyDto,
  PrincipalDto,
  CreateScheduleBody,
  ScheduleDto,
  SchedulePreviewDto,
  UpdateScheduleBody,
  ProviderDto,
  RoleBindingDto,
  RunDto,
  RunEventDto,
  SkillAssignmentDto,
  SkillDetailDto,
  SkillDto,
  TaskDto,
  TeamDto,
  UpdateAccountBody,
  UpdateAgentBody,
  UpdateGroupBody,
  UpdatePolicyBody,
  UserDto,
} from '@agent-band/contracts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const id = error.requestId ? `, request ${error.requestId}` : '';
    return `${error.message} (${error.code}${id})`;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
}

export interface Page<T> {
  items: T[];
  cursor: number;
}

export interface AuditPage {
  items: AuditEventDto[];
  nextCursor: number | null;
  cursor: number;
}

export type AuditFilter = {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
};

const BASE = '/api/v1';

function queryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function toError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const problem = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
  return new ApiError({
    status: response.status,
    code: str(problem.code) ?? `http_${String(response.status)}`,
    message:
      str(problem.detail) ?? str(problem.title) ?? `Request failed with status ${String(response.status)}`,
    requestId: str(problem.requestId),
    details: problem.details,
  });
}

export function createApi(fetchImpl?: typeof fetch) {
  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    const init: RequestInit = { method, headers: { accept: 'application/json' } };
    if (options.body !== undefined) {
      init.headers = { accept: 'application/json', 'content-type': 'application/json' };
      init.body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await doFetch(`${BASE}${path}${queryString(options.query)}`, init);
    } catch {
      throw new ApiError({
        status: 0,
        code: 'network_error',
        message: 'Could not reach the server.',
      });
    }
    if (!response.ok) throw await toError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
  const send = <T>(method: string, path: string, body?: unknown) => request<T>(method, path, { body });

  return {
    board: (query?: Query) => get<BoardDto>('/board', query),
    dashboard: () => get<DashboardDto>('/dashboard'),
    organization: () => get<OrganizationDto>('/organization'),

    tasks: {
      list: (query?: Query) => get<Page<TaskDto> & { nextCursor: string | null }>('/tasks', query),
      create: (body: CreateTaskBody) => send<TaskDto>('POST', '/tasks', body),
      reorder: (id: string, beforeId: string | null) =>
        send<TaskDto>('POST', `/tasks/${id}/reorder`, beforeId ? { beforeId } : {}),
      setPriority: (id: string, priority: number) => send<TaskDto>('PATCH', `/tasks/${id}`, { priority }),
      cancel: (id: string) => send<TaskDto>('POST', `/tasks/${id}/cancel`),
    },

    schedules: {
      list: () => get<Page<ScheduleDto>>('/schedules'),
      create: (body: CreateScheduleBody) => send<ScheduleDto>('POST', '/schedules', body),
      update: (id: string, body: UpdateScheduleBody) => send<ScheduleDto>('PATCH', `/schedules/${id}`, body),
      remove: (id: string) => send<undefined>('DELETE', `/schedules/${id}`),
      runNow: (id: string) => send<TaskDto>('POST', `/schedules/${id}/run-now`),
      tasks: (id: string) => get<Page<TaskDto>>(`/schedules/${id}/tasks`),
      preview: (cron: string, timezone?: string) =>
        get<SchedulePreviewDto>('/schedules/preview', { cron, timezone }),
    },

    agents: {
      list: (query?: Query) => get<Page<AgentDto>>('/agents', query),
      get: (id: string) => get<AgentDto>(`/agents/${id}`),
      create: (body: CreateAgentBody) => send<AgentDto>('POST', '/agents', body),
      update: (id: string, body: UpdateAgentBody) => send<AgentDto>('PATCH', `/agents/${id}`, body),
      remove: (id: string) => send<undefined>('DELETE', `/agents/${id}`),
      effectivePolicy: (id: string) => get<EffectivePolicyDto>(`/agents/${id}/effective-policy`),
      effectiveSkills: (id: string) => get<EffectiveSkillList>(`/agents/${id}/effective-skills`),
    },

    groups: {
      list: () => get<Page<AgentGroupDto>>('/agent-groups'),
      create: (body: CreateGroupBody) => send<AgentGroupDto>('POST', '/agent-groups', body),
      update: (id: string, body: UpdateGroupBody) =>
        send<AgentGroupDto>('PATCH', `/agent-groups/${id}`, body),
      remove: (id: string) => send<undefined>('DELETE', `/agent-groups/${id}`),
      addMember: (id: string, agentId: string) =>
        send<undefined>('PUT', `/agent-groups/${id}/members/${agentId}`),
      removeMember: (id: string, agentId: string) =>
        send<undefined>('DELETE', `/agent-groups/${id}/members/${agentId}`),
    },

    providers: () => get<{ items: ProviderDto[] }>('/providers'),
    accounts: {
      list: () => get<Page<AccountDto>>('/accounts'),
      create: (body: CreateAccountBody) => send<AccountDto>('POST', '/accounts', body),
      update: (id: string, body: UpdateAccountBody) => send<AccountDto>('PATCH', `/accounts/${id}`, body),
      remove: (id: string) => send<undefined>('DELETE', `/accounts/${id}`),
      probe: (id: string) => send<ProbeResult>('POST', `/accounts/${id}/probe`),
      probeConfig: (body: ProbeConfigBody) => send<ProbeResult>('POST', '/accounts/probe-config', body),
      login: (id: string, body?: { mode?: 'console' }) =>
        send<LoginResult>('POST', `/accounts/${id}/login`, body ?? {}),
      models: (id: string) => get<ModelList>(`/accounts/${id}/models`),
      refreshLimits: (id: string) => send<RefreshLimitsResult>('POST', `/accounts/${id}/refresh-limits`),
    },

    policies: {
      list: () => get<Page<PolicyDto>>('/policies'),
      get: (id: string) => get<PolicyDetailDto>(`/policies/${id}`),
      create: (body: CreatePolicyBody) => send<PolicyDetailDto>('POST', '/policies', body),
      update: (id: string, body: UpdatePolicyBody) => send<PolicyDetailDto>('PATCH', `/policies/${id}`, body),
    },

    skills: {
      list: () => get<Page<SkillDto>>('/skills'),
      get: (id: string) => get<SkillDetailDto>(`/skills/${id}`),
      import: (body: ImportSkillBody) => send<SkillDto>('POST', '/skills', body),
      newVersion: (id: string, body: NewSkillVersionBody) =>
        send<SkillDto>('POST', `/skills/${id}/versions`, body),
      assignments: (skillId?: string) => get<Page<SkillAssignmentDto>>('/skill-assignments', { skillId }),
      assign: (body: AssignSkillBody) => send<SkillAssignmentDto>('POST', '/skill-assignments', body),
      unassign: (id: string) => send<undefined>('DELETE', `/skill-assignments/${id}`),
    },

    runs: {
      list: (query?: Query) => get<Page<RunDto> & { nextCursor: string | null }>('/runs', query),
      get: (id: string) => get<RunDto>(`/runs/${id}`),
      events: (id: string, afterId = 0) => get<Page<RunEventDto>>(`/runs/${id}/events`, { afterId }),
    },

    audit: {
      list: (filter: AuditFilter & { cursor?: number; limit?: number }) => get<AuditPage>('/audit', filter),
      verify: () => get<AuditVerifyDto>('/audit/verify'),
      exportUrl: (filter: AuditFilter) => `${BASE}/audit/export${queryString(filter)}`,
    },

    users: () => get<Page<UserDto>>('/users'),
    principals: () => get<Page<PrincipalDto>>('/principals'),
    teams: {
      list: () => get<Page<TeamDto>>('/teams'),
      create: (body: CreateTeamBody) => send<TeamDto>('POST', '/teams', body),
      addMember: (teamId: string, userId: string) =>
        send<undefined>('POST', `/teams/${teamId}/members`, { userId }),
    },
    roleBindings: {
      list: () => get<Page<RoleBindingDto>>('/role-bindings'),
      create: (body: CreateRoleBindingBody) => send<RoleBindingDto>('POST', '/role-bindings', body),
      remove: (id: string) => send<undefined>('DELETE', `/role-bindings/${id}`),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
