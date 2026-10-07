import { describe, expect, it } from 'vitest';
import { PERMISSION_PRESETS, expandPresets, resolvePreApproved } from './policies.ts';

describe('permission presets', () => {
  it('has a catalog with unique ids and a risk per preset', () => {
    const ids = PERMISSION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PERMISSION_PRESETS.find((p) => p.id === 'shell-any')?.risk).toBe('high');
  });

  it('expands presets and ignores unknown ids', () => {
    expect(expandPresets(['web-read', 'shell-node', 'nope'])).toEqual([
      'WebSearch',
      'WebFetch',
      'Bash(npm:*)',
      'Bash(npx:*)',
      'Bash(node:*)',
    ]);
    expect(expandPresets(undefined)).toEqual([]);
    expect(expandPresets(['edit-files'])).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  });

  it('unions presets with custom rules without duplicates', () => {
    expect(
      resolvePreApproved({ presets: ['web-read'], preApprovedTools: ['WebSearch', 'Bash(make:*)'] }),
    ).toEqual(['WebSearch', 'WebFetch', 'Bash(make:*)']);
  });

  it('removes rules covered by deniedTools', () => {
    const rules = resolvePreApproved({
      presets: ['web-read', 'shell-git', 'shell-curl'],
      deniedTools: ['WebFetch', 'Bash(curl:*)'],
    });
    expect(rules).toEqual(['WebSearch', 'Bash(git:*)']);
    expect(resolvePreApproved({ presets: ['shell-git'], deniedTools: ['Bash'] })).toEqual([]);
    expect(resolvePreApproved({ presets: ['shell-git'], deniedTools: ['Bash(rm:*)'] })).toEqual([
      'Bash(git:*)',
    ]);
  });

  it('filters by allowedTools when set', () => {
    const base = { presets: ['web-read', 'shell-git'] } as const;
    expect(resolvePreApproved({ ...base, allowedTools: ['WebSearch', 'Bash(git:*)'] })).toEqual([
      'WebSearch',
      'Bash(git:*)',
    ]);
    expect(resolvePreApproved({ ...base, allowedTools: [] })).toEqual([]);
    expect(resolvePreApproved(base)).toHaveLength(3);
  });
});
