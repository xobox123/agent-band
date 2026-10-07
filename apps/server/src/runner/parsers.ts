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

const GEMINI_QUOTA =
  /quota|rate.?limit|resource_exhausted|\b429\b|exhausted your capacity|usage limit|limit reached/i;
const UNIT_SECONDS = { h: 3600, m: 60, s: 1 } as const;

/** Best-known reset time from Gemini quota wording such as "reset after 3h24m5s" or "retry in 34.5s". */
export function geminiResetsAt(message: string, now = Date.now()): string | null {
  const m = /(?:resets? (?:after|in)|retry (?:in|after))\s+((?:\d+(?:\.\d+)?\s*[hms]\s*)+)/i.exec(message);
  if (!m?.[1]) return null;
  let seconds = 0;
  for (const part of m[1].matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)) {
    seconds += Number(part[1]) * UNIT_SECONDS[(part[2] ?? 's').toLowerCase() as keyof typeof UNIT_SECONDS];
  }
  return seconds > 0 ? new Date(now + Math.ceil(seconds) * 1000).toISOString() : null;
}

function geminiFailure(message: string, now: number): NormalizedEvent[] {
  return [
    { kind: 'error', message },
    ...(GEMINI_QUOTA.test(message)
      ? [
          {
            kind: 'rate_limit' as const,
            windows: [],
            limitReached: true,
            resetsAt: geminiResetsAt(message, now),
          },
        ]
      : []),
  ];
}

/** Gemini CLI `--output-format stream-json`: one JSON object per line, no cost field. */
export function parseGeminiLine(line: string, now = Date.now()): NormalizedEvent[] {
  const e = object(JSON.parse(line));
  switch (e.type) {
    case 'init':
      return typeof e.session_id === 'string' ? [{ kind: 'session', sessionId: e.session_id }] : [];
    case 'message':
      return e.role === 'assistant' && typeof e.content === 'string' && e.content
        ? [{ kind: 'text', text: e.content }]
        : [];
    case 'tool_use':
      return typeof e.tool_name === 'string'
        ? [
            {
              kind: 'tool',
              name: e.tool_name,
              input: e.parameters,
              ...(typeof e.tool_id === 'string' ? { toolUseId: e.tool_id } : {}),
            },
          ]
        : [];
    case 'tool_result': {
      if (e.status !== 'error') return [];
      const message = object(e.error).message;
      return [
        {
          kind: 'stderr',
          text: `tool ${String(e.tool_id)} failed: ${typeof message === 'string' ? message : 'error'}`,
        },
      ];
    }
    case 'error': {
      const message = typeof e.message === 'string' ? e.message : 'Gemini error';
      return e.severity === 'warning'
        ? [{ kind: 'stderr', text: `warning: ${message}` }]
        : geminiFailure(message, now);
    }
    case 'result': {
      const stats = object(e.stats);
      const cached = number(stats.cached);
      // `input` is the uncached part; `input_tokens` includes the cached tokens.
      const input =
        typeof stats.input === 'number' ? stats.input : Math.max(0, number(stats.input_tokens) - cached);
      const failure = object(e.error).message;
      return [
        {
          kind: 'usage',
          inputTokens: input,
          outputTokens: number(stats.output_tokens),
          cachedTokens: cached,
        },
        ...(e.status === 'error'
          ? geminiFailure(typeof failure === 'string' ? failure : 'Gemini run failed', now)
          : []),
      ];
    }
    default:
      return [];
  }
}
