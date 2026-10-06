import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, errorMessage } from './client.ts';
import { createEventsClient } from './events.ts';
import type { ConnectionState } from './events.ts';

function problem(status: number, code: string, detail: string) {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: 'Problem', status, code, detail, requestId: 'req-9' }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

describe('api client', () => {
  it('maps problem+json to a typed ApiError', async () => {
    const api = createApi(vi.fn(() => Promise.resolve(problem(409, 'stale_entity', 'This item changed.'))));
    const error = await api.tasks.cancel('t1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe('stale_entity');
    expect(apiError.message).toBe('This item changed.');
    expect(apiError.requestId).toBe('req-9');
    expect(errorMessage(apiError)).toBe('This item changed. (stale_entity, request req-9)');
  });

  it('falls back to a status code for non-problem bodies and maps network failures', async () => {
    const html = createApi(vi.fn(() => Promise.resolve(new Response('<html>', { status: 502 }))));
    const e1 = (await html.board().catch((e: unknown) => e)) as ApiError;
    expect(e1.code).toBe('http_502');

    const down = createApi(vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    const e2 = (await down.board().catch((e: unknown) => e)) as ApiError;
    expect(e2.code).toBe('network_error');
    expect(e2.status).toBe(0);
  });

  it('sends JSON bodies, builds queries and accepts 204', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json({ items: [], cursor: 1 }),
      ),
    );
    const api = createApi(fetchMock as unknown as typeof fetch);
    await api.runs.list({ status: 'running', agentId: undefined });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/runs?status=running');
    await api.tasks.reorder('t1', 'b1');
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ beforeId: 'b1' }));
    await expect(api.agents.remove('a1')).resolves.toBeUndefined();
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  handlers = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, id: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id });
    this.handlers.get(type)?.forEach((fn) => {
      fn(event);
    });
  }
}

describe('events client', () => {
  it('delivers typed events, tracks connection state and reconnects with the last id', () => {
    FakeEventSource.instances = [];
    const timers: (() => void)[] = [];
    const client = createEventsClient({
      eventSource: FakeEventSource as unknown as typeof EventSource,
      setTimer: (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
    });
    const states: ConnectionState[] = [];
    const received: string[] = [];
    client.onState((s) => states.push(s));
    client.subscribe((e) => received.push(`${e.type}:${e.id}`));

    const first = FakeEventSource.instances[0];
    expect(first?.url).toBe('/api/v1/events');
    first?.onopen?.();
    first?.emit('task.created', '7', { orgId: 'o' });
    first?.emit('reset', '9', { cursor: 9 });
    expect(received).toEqual(['task.created:7', 'reset:9']);
    expect(client.state()).toBe('connected');

    if (first) first.readyState = 2;
    first?.onerror?.();
    expect(states).toEqual(['connected', 'reconnecting']);
    timers[0]?.();
    expect(FakeEventSource.instances[1]?.url).toBe('/api/v1/events?lastEventId=9');
  });

  it('closes the stream after the last listener leaves', () => {
    FakeEventSource.instances = [];
    const client = createEventsClient({ eventSource: FakeEventSource as unknown as typeof EventSource });
    const off = client.subscribe(() => undefined);
    off();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });
});
