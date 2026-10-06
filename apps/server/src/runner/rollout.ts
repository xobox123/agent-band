import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedEvent } from '@agent-band/contracts';
import { iso, object } from './parsers.ts';

export async function readCodexRateLimits(
  codexHome: string,
  threadId: string,
): Promise<NormalizedEvent | null> {
  if (!threadId || /[/\\]/.test(threadId)) return null;
  const root = join(codexHome, 'sessions');
  let files: string[];
  try {
    files = await readdir(root, { recursive: true });
  } catch {
    return null;
  }
  for (const file of files.sort().reverse()) {
    if (!file.split('/').at(-1)?.startsWith('rollout-') || !file.endsWith(`-${threadId}.jsonl`)) continue;
    let content: string;
    try {
      content = await readFile(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n').reverse()) {
      let payload: Record<string, unknown>;
      try {
        payload = object(object(JSON.parse(line)).payload);
      } catch {
        continue;
      }
      if (payload.type !== 'token_count') continue;
      if (!payload.rate_limits) return null;
      const limits = object(payload.rate_limits);
      const windows: Extract<NormalizedEvent, { kind: 'rate_limit' }>['windows'] = [];
      for (const [key, window] of [
        ['primary', '5h'],
        ['secondary', 'weekly'],
      ] as const) {
        const w = object(limits[key]);
        if (typeof w.used_percent === 'number')
          windows.push({ window, usedPercent: w.used_percent, resetsAt: iso(w.resets_at) });
      }
      const reached = windows.filter((w) => w.usedPercent >= 100);
      return {
        kind: 'rate_limit',
        windows,
        limitReached: reached.length > 0,
        resetsAt:
          reached
            .map((w) => w.resetsAt)
            .filter((s): s is string => s !== null)
            .sort()
            .at(-1) ?? null,
      };
    }
  }
  return null;
}
