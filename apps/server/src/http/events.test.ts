import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { pruneOutbox } from '../platform/outbox.ts';
import { makeApi, type TestApi } from './test-helpers.ts';

let api: TestApi;
let base: string;
beforeEach(async () => {
  api = await makeApi({ heartbeatMs: 50 });
  await api.app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}/api/v1`;
});
afterEach(async () => {
  await api.close();
});

interface Stream {
  text(): string;
  waitFor(pattern: string | RegExp, ms?: number): Promise<void>;
  close(): void;
}

async function openStream(lastEventId?: number): Promise<Stream> {
  const ctl = new AbortController();
  const res = await fetch(`${base}/events`, {
    headers: lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) },
    signal: ctl.signal,
  });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  let buf = '';
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const r = await reader?.read();
        if (!r || r.done) return;
        buf += decoder.decode(r.value as Uint8Array, { stream: true });
      }
    } catch {
      // aborted
    }
  })();
  return {
    text: () => buf,
    async waitFor(pattern, ms = 5000) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (typeof pattern === 'string' ? buf.includes(pattern) : pattern.test(buf)) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timeout waiting for ${String(pattern)}; got:\n${buf}`);
    },
    close: () => {
      ctl.abort();
    },
  };
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createTask(title: string): Promise<void> {
  const account = await api.c.accounts.createAccount(api.database.db, api.c.localUser, {
    name: `acc-${title}`,
    provider: 'claude',
    type: 'cli',
  });
  const task = await post('/tasks', { title, prompt: 'p', workDir: '/w', target: { label: account.name } });
  expect(task.status).toBe(201);
}

it('delivers task.updated live with the outbox id and sends heartbeats', async () => {
  const s = await openStream();
  await createTask('live');
  await s.waitFor(/id: \d+\nevent: task\.updated\ndata: \{[^\n]*"taskId"/);
  await s.waitFor(': heartbeat');
  s.close();
});

it('replays missed events from Last-Event-ID in order without duplicates', async () => {
  const cursor = await api.c.cursor();
  await createTask('one');
  await createTask('two');
  const s = await openStream(cursor);
  await s.waitFor(/event: task\.updated[\s\S]*event: task\.updated/);
  const ids = [...s.text().matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => id > cursor)).toBe(true);
  expect(s.text()).not.toContain('event: reset');
  s.close();
});

it('only streams events of the actor org', async () => {
  const s = await openStream();
  await api.database.db.execute(
    sql`insert into outbox_events (type, payload) values ('task.updated', '{"orgId":"00000000-0000-0000-0000-000000000000"}')`,
  );
  await createTask('mine');
  await s.waitFor('"taskId"');
  expect(s.text()).not.toContain('00000000-0000-0000-0000-000000000000');
  s.close();
});

it('sends reset when the id is older than retention or from the future', async () => {
  await createTask('old');
  await api.database.db.execute(sql`update outbox_events set ts = now() - interval '25 hours'`);
  expect(await pruneOutbox(api.database.db)).toBeGreaterThan(0);
  await createTask('fresh');

  const stale = await openStream(1);
  await stale.waitFor(/event: reset\ndata: \{"cursor":\d+\}/);
  stale.close();

  const future = await openStream(999_999);
  await future.waitFor('event: reset');
  future.close();
});

it('rejects an actor without read access before opening the stream', async () => {
  api.as({ orgId: api.c.orgId, principalId: crypto.randomUUID(), kind: 'user', requestId: 'x' });
  const res = await fetch(`${base}/events`);
  expect(res.status).toBe(403);
});
