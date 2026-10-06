import { createApi } from './api/client.ts';
import type { Api } from './api/client.ts';
import { createStaticEvents } from './api/events.ts';
import type { EventsClient } from './api/events.ts';
import { ApiProvider } from './api/context.tsx';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

export type Routes = Record<string, unknown>;

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Fetch stub: keys are `METHOD /path` (no /api/v1 prefix, no query). Unlisted routes answer 404 problem+json. */
export function fakeFetch(routes: Routes) {
  const calls: Call[] = [];
  const impl = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'http://localhost',
    );
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init.method ?? 'GET';
    calls.push({
      method,
      path,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const entry = routes[`${method} ${path}`];
    if (entry === undefined) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            code: 'not_found',
            detail: `No route ${method} ${path}`,
            requestId: 'req-1',
          }),
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      );
    }
    const value =
      typeof entry === 'function' ? (entry as (i: RequestInit, u: URL) => unknown)(init, url) : entry;
    if (value instanceof Response) return Promise.resolve(value);
    if (value === null) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(
      new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

export function testApi(routes: Routes): { api: Api; calls: Call[] } {
  const { fetch, calls } = fakeFetch(routes);
  return { api: createApi(fetch), calls };
}

export function Providers({
  api,
  events,
  children,
}: {
  api: Api;
  events?: EventsClient;
  children: ReactNode;
}) {
  return (
    <ApiProvider api={api} events={events ?? createStaticEvents()}>
      {children}
    </ApiProvider>
  );
}

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const NOW = '2026-10-06T10:00:00.000Z';

export function agentDto(over: Record<string, unknown> = {}) {
  return {
    id: ID(1),
    orgId: ID(100),
    slug: 'ada',
    handle: 'agent:ada',
    name: 'Ada',
    avatar: null,
    accountId: ID(10),
    model: 'claude-opus',
    role: 'leader',
    persona: 'Careful reviewer',
    systemPrompt: null,
    labels: ['backend'],
    groupIds: [],
    policyId: null,
    enabled: true,
    gitIdentity: { name: 'Ada (agent-band)', email: 'ada@agents.agent-band.local' },
    createdBy: ID(200),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function accountDto(over: Record<string, unknown> = {}) {
  return {
    id: ID(10),
    orgId: ID(100),
    name: 'Claude Max',
    provider: 'claude',
    type: 'cli',
    providerConfig: {},
    configDir: null,
    labels: [],
    limits: { maxConcurrentRuns: 2, dailyTokenBudget: 1_000_000 },
    providerIdentity: null,
    hasSecret: false,
    secretUpdatedAt: null,
    createdBy: ID(200),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function taskDto(over: Record<string, unknown> = {}) {
  return {
    id: ID(30),
    orgId: ID(100),
    key: 'AB-1',
    title: 'Fix the thing',
    prompt: 'Please fix it',
    workDir: '/work',
    target: { agentId: ID(1) },
    priority: 2,
    rank: 1,
    mode: null,
    status: 'queued',
    runAt: null,
    scheduleId: null,
    attempt: 1,
    maxAttempts: 3,
    resumeAt: null,
    workerId: null,
    error: null,
    createdBy: ID(200),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function runDto(over: Record<string, unknown> = {}) {
  return {
    id: ID(40),
    orgId: ID(100),
    taskId: ID(30),
    agentId: ID(1),
    accountId: ID(10),
    workerId: 'worker-1',
    effectivePolicy: {},
    skills: [],
    status: 'running',
    startedAt: NOW,
    finishedAt: null,
    exitCode: null,
    inputTokens: 1200,
    outputTokens: 300,
    cachedTokens: 50,
    costUsd: null,
    rateLimitResetsAt: null,
    error: null,
    ...over,
  };
}

export const list = <T,>(items: T[]) => ({ items, cursor: 5 });

export function scheduleDto(over: Record<string, unknown> = {}) {
  return {
    id: ID(50),
    orgId: ID(100),
    name: 'Nightly audit',
    enabled: true,
    cron: '0 9 * * 1-5',
    timezone: null,
    template: {
      title: 'Audit dependencies',
      prompt: 'Check advisories',
      workDir: '/work',
      target: { agentId: ID(1) },
      priority: 2,
    },
    overlap: 'skip',
    lastFiredAt: null,
    lastTaskId: null,
    nextFireAt: '2026-10-07T07:00:00.000Z',
    createdBy: ID(200),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}
