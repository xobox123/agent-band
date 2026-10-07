import { expect, it } from 'vitest';
import { NormalizedEvent } from '@agent-band/contracts';
import { parseClaudeLine } from './parsers.ts';

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
