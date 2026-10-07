import type { NormalizedEvent } from '@agent-band/contracts';

export function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
const number = (value: unknown) => (typeof value === 'number' ? value : 0);
export const iso = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
export function errors(message: string): NormalizedEvent[] {
  return [
    { kind: 'error', message },
    ...(/usage limit|rate limit|limit reached/i.test(message)
      ? [{ kind: 'rate_limit' as const, windows: [], limitReached: true, resetsAt: null }]
      : []),
  ];
}
export function parseClaudeLine(line: string): NormalizedEvent[] {
  const e = object(JSON.parse(line));
  if (e.type === 'rate_limit_event') {
    const info = object(e.rate_limit_info),
      unified = object(info.unifiedWindows);
    const windows: Extract<NormalizedEvent, { kind: 'rate_limit' }>['windows'] = [];
    for (const [key, window] of [
      ['five_hour', '5h'],
      ['seven_day', 'weekly'],
    ] as const) {
      if (unified[key]) {
        const w = object(unified[key]);
        windows.push({
          window,
          usedPercent: Math.round(number(w.utilization) * 1000) / 10,
          resetsAt: iso(w.resetsAt),
        });
      }
    }
    return [
      { kind: 'rate_limit', windows, limitReached: info.status === 'rejected', resetsAt: iso(info.resetsAt) },
    ];
  }
  if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string')
    return [{ kind: 'session', sessionId: e.session_id }];
  if (e.type === 'assistant') {
    const content = object(e.message).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((value: unknown): NormalizedEvent[] => {
      const block = object(value);
      if (block.type === 'text' && typeof block.text === 'string' && block.text)
        return [{ kind: 'text', text: block.text }];
      if (block.type === 'tool_use' && typeof block.name === 'string')
        return [
          {
            kind: 'tool',
            name: block.name,
            input: block.input,
            ...(typeof block.id === 'string' ? { toolUseId: block.id } : {}),
          },
        ];
      return [];
    });
  }
  if (e.type === 'result') {
    const u = object(e.usage);
    return [
      {
        kind: 'usage',
        inputTokens: number(u.input_tokens) + number(u.cache_creation_input_tokens),
        outputTokens: number(u.output_tokens),
        cachedTokens: number(u.cache_read_input_tokens),
        ...(typeof e.total_cost_usd === 'number' ? { costUsd: e.total_cost_usd } : {}),
      },
      ...(e.is_error === true ? errors(typeof e.result === 'string' ? e.result : 'Claude run failed') : []),
    ];
  }
  return [];
}
export function parseCodexLine(line: string): NormalizedEvent[] {
  const e = object(JSON.parse(line));
  if (e.type === 'thread.started' && typeof e.thread_id === 'string')
    return [{ kind: 'session', sessionId: e.thread_id }];
  if (e.type === 'item.completed') {
    const item = object(e.item);
    if (item.type === 'reasoning') return [];
    if (item.type === 'agent_message')
      return typeof item.text === 'string' ? [{ kind: 'text', text: item.text }] : [];
    return typeof item.type === 'string' ? [{ kind: 'tool', name: item.type, input: item }] : [];
  }
  if (e.type === 'turn.completed') {
    const u = object(e.usage);
    return [
      {
        kind: 'usage',
        inputTokens: number(u.input_tokens) - number(u.cached_input_tokens),
        outputTokens: number(u.output_tokens) + number(u.reasoning_output_tokens),
        cachedTokens: number(u.cached_input_tokens),
      },
    ];
  }
  if (e.type === 'error' || e.type === 'turn.failed') {
    const message = e.type === 'error' ? e.message : object(e.error).message;
    return errors(typeof message === 'string' ? message : 'Codex run failed');
  }
  return [];
}
