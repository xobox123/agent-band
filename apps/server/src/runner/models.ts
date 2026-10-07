import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelOption } from '@agent-band/contracts';
import { withCodexAppServer, type AppServerOptions } from './codex-app-server.ts';
import { object } from './parsers.ts';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const alias = (id: string, label: string, description: string, isDefault = false): ModelOption => ({
  id,
  label,
  description,
  isDefault,
  source: 'builtin',
  recommended: true,
});
const full = (id: string, label: string): ModelOption => ({
  id,
  label,
  isDefault: false,
  source: 'builtin',
});

export const CLAUDE_MODELS: readonly ModelOption[] = [
  alias('default', 'Default (account plan)', 'The model Claude Code picks for this account', true),
  alias('sonnet', 'Sonnet', 'Latest Sonnet'),
  alias('opus', 'Opus', 'Latest Opus'),
  alias('haiku', 'Haiku', 'Latest Haiku'),
  alias('opusplan', 'Opus plan', 'Opus for planning, Sonnet for execution'),
  full('claude-opus-5-5', 'Opus 5.5'),
  full('claude-sonnet-5-5', 'Sonnet 5.5'),
  full('claude-haiku-4-5-20251001', 'Haiku 4.5'),
  full('claude-fable-5-1', 'Fable 5.1'),
];

export const GEMINI_MODELS: readonly ModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', isDefault: true, source: 'builtin' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', isDefault: false, source: 'builtin' },
];

/** One page of the app-server `model/list` response. */
export function parseCodexModelPage(result: Record<string, unknown>): {
  items: ModelOption[];
  next: string | null;
} {
  const data = Array.isArray(result.data) ? result.data : [];
  const items: ModelOption[] = [];
  for (const raw of data) {
    const m = object(raw);
    const id = str(m.model) ?? str(m.id);
    if (!id || m.hidden === true) continue;
    const description = str(m.description);
    items.push({
      id,
      label: str(m.displayName) ?? id,
      ...(description && { description }),
      isDefault: m.isDefault === true,
      source: 'native',
    });
  }
  return { items, next: str(result.nextCursor) };
}

export async function listCodexModels(
  env: NodeJS.ProcessEnv,
  opts: AppServerOptions,
): Promise<ModelOption[]> {
  return withCodexAppServer(env, opts, async (rpc) => {
    const all: ModelOption[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res = await rpc.request('model/list', { cursor, includeHidden: false, limit: 100 });
      const parsed = parseCodexModelPage(res);
      all.push(...parsed.items);
      cursor = parsed.next;
      if (!cursor) break;
    }
    if (all.length === 0) throw new Error('codex returned no models');
    return all;
  });
}

/** Reads the CLI's own `models_cache.json` from a Codex home. */
export async function readCodexModelsCache(codexHome: string): Promise<ModelOption[]> {
  const json = object(JSON.parse(await readFile(join(codexHome, 'models_cache.json'), 'utf8')));
  const models = (Array.isArray(json.models) ? json.models : [])
    .map((m) => object(m))
    .filter((m) => str(m.slug) && m.visibility !== 'hide' && m.visibility !== 'none')
    .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999));
  const items = models.map((m, i): ModelOption => {
    const description = str(m.description);
    return {
      id: m.slug as string,
      label: str(m.display_name) ?? (m.slug as string),
      ...(description && { description }),
      isDefault: i === 0,
      source: 'native',
    };
  });
  if (items.length === 0) throw new Error('models cache is empty');
  return items;
}

/** `GET {baseUrl}/models` of an OpenAI-compatible endpoint. */
export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string | null,
  timeoutMs = 10_000,
): Promise<ModelOption[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { accept: 'application/json', ...(apiKey && { authorization: `Bearer ${apiKey}` }) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`endpoint answered ${res.status}`);
  const body = object(await res.json());
  const data = Array.isArray(body.data) ? body.data : [];
  const ids = data.map((m) => str(object(m).id)).filter((id): id is string => id !== null);
  return [...new Set(ids)].map((id) => ({ id, label: id, isDefault: false, source: 'native' }));
}
