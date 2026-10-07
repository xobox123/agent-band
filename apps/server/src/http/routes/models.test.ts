import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelList } from '@agent-band/contracts';
import { fakeBins } from '../../runner/fake-cli.testkit.ts';
import { makeApi, type TestApi } from '../test-helpers.ts';

const FIXTURE = join(import.meta.dirname, '../../runner/codex-model-list.fixture.json');

let api: TestApi;
let home: string;
let server: Server | undefined;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  api = await makeApi({ cliBins: fakeBins(), home });
});
afterEach(async () => {
  delete process.env.FAKE_MODEL_LIST;
  delete process.env.FAKE_MODE;
  vi.useRealTimers();
  server?.close();
  server?.closeAllConnections();
  await api.close();
});
async function call(method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await api.app.inject({ method, url: `/api/v1${url}`, payload: payload as object });
  return { status: res.statusCode, json: () => JSON.parse(res.body) as Record<string, unknown> };
}
const create = async (body: object) => (await call('POST', '/accounts', body)).json().id as string;

describe('GET /accounts/:id/models', () => {
  it('returns the builtin Claude list', async () => {
    const id = await create({ name: 'C', provider: 'claude', type: 'cli' });
    const res = await call('GET', `/accounts/${id}/models`);
    expect(res.status).toBe(200);
    const list = ModelList.parse(res.json());
    expect(list.items[0]).toMatchObject({ id: 'default', source: 'builtin', recommended: true });
  });

  it('reads codex models natively and caches them for an hour', async () => {
    process.env.FAKE_MODEL_LIST = FIXTURE;
    vi.useFakeTimers({ toFake: ['Date'] });
    const dir = mkdtempSync(join(tmpdir(), 'codex-'));
    const id = await create({ name: 'X', provider: 'openai', type: 'cli', configDir: dir });
    const first = ModelList.parse((await call('GET', `/accounts/${id}/models`)).json());
    expect(first.items[0]).toMatchObject({ id: 'gpt-6.1-sol', isDefault: true, source: 'native' });
    expect(first.items).toHaveLength(7);

    process.env.FAKE_MODE = 'no-app-server';
    delete process.env.FAKE_MODEL_LIST;
    const cached = ModelList.parse((await call('GET', `/accounts/${id}/models`)).json());
    expect(cached.fetchedAt).toBe(first.fetchedAt);

    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect((await call('GET', `/accounts/${id}/models`)).status).toBe(400);
  });

  it('follows pagination cursors', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'pages-')), 'pages.json');
    writeFileSync(
      f,
      JSON.stringify([
        { data: [{ model: 'one', displayName: 'One', isDefault: true, hidden: false }] },
        { data: [{ model: 'two', displayName: 'Two', isDefault: false, hidden: false }] },
      ]),
    );
    process.env.FAKE_MODEL_LIST = f;
    const id = await create({ name: 'X', provider: 'openai', type: 'cli' });
    const list = ModelList.parse((await call('GET', `/accounts/${id}/models`)).json());
    expect(list.items.map((m) => m.id)).toEqual(['one', 'two']);
  });

  it('falls back to models_cache.json in the account home', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'models_cache.json'),
      JSON.stringify({
        models: [{ slug: 'cached-1', display_name: 'Cached', priority: 1, visibility: 'list' }],
      }),
    );
    process.env.FAKE_MODE = 'no-app-server';
    const id = await create({ name: 'X', provider: 'openai', type: 'cli', configDir: dir });
    const list = ModelList.parse((await call('GET', `/accounts/${id}/models`)).json());
    expect(list.items.map((m) => m.id)).toEqual(['cached-1']);
    expect(list.note).toMatch(/cache/);
  });

  it('lists models of an openai compatible endpoint with the stored key', async () => {
    let hits = 0;
    let auth: string | undefined;
    server = createServer((req, res) => {
      hits += 1;
      auth = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'llama-3' }, { id: 'qwen' }] }));
    });
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const id = await create({
      name: 'Local',
      provider: 'openai_compatible',
      type: 'api',
      providerConfig: { baseUrl },
      secret: 'sk-secret',
    });
    const res = await call('GET', `/accounts/${id}/models`);
    const list = ModelList.parse(res.json());
    expect(list.items.map((m) => m.id)).toEqual(['llama-3', 'qwen']);
    expect(auth).toBe('Bearer sk-secret');
    expect(JSON.stringify(res.json())).not.toContain('sk-secret');
    await call('GET', `/accounts/${id}/models`);
    expect(hits).toBe(1);
  });

  it('returns 404 for an unknown account and needs read access', async () => {
    expect((await call('GET', `/accounts/${crypto.randomUUID()}/models`)).status).toBe(404);
  });
});
