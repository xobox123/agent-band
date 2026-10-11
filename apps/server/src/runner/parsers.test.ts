import { expect, it } from 'vitest';
import { NormalizedEvent } from '@agent-band/contracts';
import { parseClaudeLine, parseCodexLine } from './parsers.ts';

it('preserves Claude tool use ids for decision correlation and accepts legacy tools', () => {
  expect(
    parseClaudeLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/w/a' } }],
        },
      }),
    ),
  ).toEqual([{ kind: 'tool', toolUseId: 'tool-1', name: 'Read', input: { file_path: '/w/a' } }]);
  expect(
    NormalizedEvent.parse({ kind: 'tool_decision', decision: 'deny', reason: 'policy', toolUseId: 'tool-1' })
      .kind,
  ).toBe('tool_decision');
  expect(NormalizedEvent.parse({ kind: 'tool', name: 'Read' }).kind).toBe('tool');
});

it('reports denied actions of Claude results and declined Codex items', () => {
  const events = parseClaudeLine(
    JSON.stringify({
      type: 'result',
      usage: {},
      permission_denials: [
        { tool_name: 'Bash', tool_input: { command: 'npm install' } },
        { tool_name: 'WebFetch' },
      ],
    }),
  );
  expect(events[0]).toEqual({ kind: 'permission_denied', actions: ['Bash', 'WebFetch'] });
  expect(parseClaudeLine(JSON.stringify({ type: 'result', usage: {}, permission_denials: [] }))).toHaveLength(
    1,
  );
  const codex = parseCodexLine(
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'npm install', status: 'declined' },
    }),
  );
  expect(codex.map((e) => e.kind)).toEqual(['tool', 'permission_denied']);
  expect(codex[1]).toEqual({ kind: 'permission_denied', actions: ['command_execution: npm install'] });
  for (const e of [...events, ...codex]) NormalizedEvent.parse(e);
});
