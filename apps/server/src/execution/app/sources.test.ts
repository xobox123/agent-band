import { describe, expect, it } from 'vitest';
import { createEffectivePolicySource, createEffectiveSkillsSource } from './sources.ts';

describe('real sources', () => {
  it('build without touching the database', () => {
    const bindings = { forAgent: () => Promise.reject(new Error('unused')) };
    expect(createEffectivePolicySource({ bindings })).toHaveProperty('forAgent');
    expect(
      createEffectiveSkillsSource({ membership: { groupIdsOf: () => Promise.resolve([]) } }),
    ).toHaveProperty('loadBundle');
  });
});
