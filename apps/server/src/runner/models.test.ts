import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './codex-model-list.fixture.json' with { type: 'json' };
import {
  CLAUDE_MODELS,
  GEMINI_MODELS,
  fetchOpenAiCompatibleModels,
  parseCodexModelPage,
  readCodexModelsCache,
} from './models.ts';

describe('codex model/list parsing', () => {
  it('maps the captured response', () => {
    const page = parseCodexModelPage(fixture[0] as Record<string, unknown>);
    expect(page.next).toBeNull();
    expect(page.items.map((m) => m.id)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(page.items[0]).toEqual({
      id: 'gpt-6.1-sol',
      label: 'GPT-6.1-Sol',
      description: 'Latest workhorse model for coding and everyday work.',
      isDefault: true,
      source: 'native',
    });
    expect(page.items.filter((m) => m.isDefault)).toHaveLength(1);
  });

  it('skips hidden models and reports the next cursor', () => {
    const page = parseCodexModelPage({
      data: [
        { model: 'a', displayName: 'A', hidden: true, isDefault: false },
        { model: 'b', hidden: false, isDefault: false },
      ],
      nextCursor: 'c2',
    });
    expect(page).toEqual({
      items: [{ id: 'b', label: 'b', isDefault: false, source: 'native' }],
      next: 'c2',
    });
  });
});

describe('codex models cache', () => {
  it('reads visible models in priority order', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(
      join(home, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'b', display_name: 'B', priority: 2, visibility: 'list' },
          { slug: 'a', display_name: 'A', description: 'first', priority: 1, visibility: 'list' },
          { slug: 'hidden', priority: 0, visibility: 'hide' },
        ],
      }),
    );
    const items = await readCodexModelsCache(home);
    expect(items.map((m) => [m.id, m.label, m.isDefault])).toEqual([
      ['a', 'A', true],
      ['b', 'B', false],
    ]);
  });

  it('fails when there is no cache', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    mkdirSync(home, { recursive: true });
    await expect(readCodexModelsCache(home)).rejects.toThrow();
  });
});

describe('builtin lists', () => {
  it('lists the Claude aliases first and marks them recommended', () => {
    const ids = CLAUDE_MODELS.map((m) => m.id);
    expect(ids).toEqual([
      'default',
      'sonnet',
      'opus',
      'haiku',
      'opusplan',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-4-5-20251001',
      'claude-fable-5-1',
    ]);
    expect(CLAUDE_MODELS[0]).toMatchObject({ label: 'Default (account plan)', isDefault: true });
    expect(CLAUDE_MODELS.filter((m) => m.recommended).map((m) => m.id)).toEqual(ids.slice(0, 5));
    expect(CLAUDE_MODELS.every((m) => m.source === 'builtin')).toBe(true);
    expect(CLAUDE_MODELS.find((m) => m.id === 'claude-fable-5-1')?.label).toBe('Fable 5.1');
  });

  it('has a gemini list', () => {
    expect(GEMINI_MODELS.length).toBeGreaterThan(0);
  });
});

describe('openai compatible /models', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server?.closeAllConnections();
  });
  const start = async (handler: Parameters<typeof createServer>[1]) => {
    server = createServer(handler);
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  };

  it('sends the key and maps ids', async () => {
    let auth: string | undefined;
    const base = await start((req, res) => {
      auth = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm1' }] }));
    });
    const items = await fetchOpenAiCompatibleModels(`${base}/`, 'sk-test');
    expect(auth).toBe('Bearer sk-test');
    expect(items.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('fails on an error status and on timeout', async () => {
    const bad = await start((_req, res) => {
      res.statusCode = 401;
      res.end('no');
    });
    await expect(fetchOpenAiCompatibleModels(bad, null)).rejects.toThrow('401');
    server?.close();
    server?.closeAllConnections();
    const slow = await start(() => undefined);
    await expect(fetchOpenAiCompatibleModels(slow, null, 100)).rejects.toThrow();
  });
});
