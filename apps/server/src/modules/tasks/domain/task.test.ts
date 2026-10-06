import { expect, it } from 'vitest';
import { CreateTask, boardColumn } from './task.ts';
it('validates priority, finite rank, absolute paths and exactly one target', () => {
  const input = { title: 'Task', prompt: 'Prompt', workDir: '/work', target: { label: 'backend' } };
  expect(CreateTask.parse(input)).toMatchObject({ priority: 2, rank: 0 });
  for (const patch of [
    { priority: 4 },
    { priority: -1 },
    { rank: Infinity },
    { workDir: 'relative' },
    { target: { label: 'backend', agentGroupId: 'bad' } },
  ])
    expect(CreateTask.safeParse({ ...input, ...patch }).success).toBe(false);
  expect(boardColumn('claimed')).toBe('running');
  expect(boardColumn('denied')).toBe('failed');
});
