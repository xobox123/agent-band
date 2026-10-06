import { describe, expect, it } from 'vitest';
import { decideTool, type ToolPolicySnapshot } from './tool-authz.ts';

const policy = (p: Partial<ToolPolicySnapshot> = {}): ToolPolicySnapshot => ({
  deniedTools: [],
  workDirSets: [['/work']],
  ...p,
});
const decide = (p: ToolPolicySnapshot, tool: string, input?: unknown) =>
  decideTool(p, '/work/repo', tool, input).decision;

describe('decideTool', () => {
  it('allows when nothing restricts the tool', () => {
    expect(decide(policy(), 'Bash', { command: 'ls' })).toBe('allow');
  });
  it('denies denied tools by name, wildcard and ignores scoped rules', () => {
    expect(decide(policy({ deniedTools: ['Bash'] }), 'Bash')).toBe('deny');
    expect(decide(policy({ deniedTools: ['mcp__x__*'] }), 'mcp__x__y')).toBe('deny');
    expect(decide(policy({ deniedTools: ['Bash(rm:*)'] }), 'Bash')).toBe('allow');
  });
  it('requires allowed tools to match when set, also for scoped rules', () => {
    const p = policy({ allowedTools: ['Read', 'Bash(git:*)'] });
    expect(decide(p, 'Read', { file_path: '/work/a' })).toBe('allow');
    expect(decide(p, 'Bash')).toBe('allow');
    expect(decide(p, 'Write', { file_path: '/work/a' })).toBe('deny');
  });
  it('denies paths outside workDirs, resolving relative paths and ..', () => {
    expect(decide(policy(), 'Read', { file_path: '/etc/passwd' })).toBe('deny');
    expect(decide(policy(), 'Edit', { file_path: 'src/a.ts' })).toBe('allow');
    expect(decide(policy(), 'Write', { file_path: '../../etc/x' })).toBe('deny');
    expect(decide(policy(), 'Write', { file_path: '/work-evil/x' })).toBe('deny');
    expect(decide(policy(), 'NotebookEdit', { notebook_path: '/work/n.ipynb' })).toBe('allow');
    expect(decide(policy(), 'MultiEdit', { file_path: '/tmp/x' })).toBe('deny');
  });
  it('denies path tools without a usable path and home-relative paths', () => {
    expect(decide(policy(), 'Read', {})).toBe('deny');
    expect(decide(policy(), 'Read', undefined)).toBe('deny');
    expect(decide(policy(), 'Read', { file_path: '~/.ssh/id_rsa' })).toBe('deny');
  });
  it('checks Glob and Grep paths and absolute glob patterns', () => {
    expect(decide(policy(), 'Grep', { pattern: 'x' })).toBe('allow');
    expect(decide(policy(), 'Grep', { pattern: 'x', path: '/etc' })).toBe('deny');
    expect(decide(policy(), 'Glob', { pattern: '/etc/**/*.conf' })).toBe('deny');
    expect(decide(policy(), 'Glob', { pattern: '/work/repo/**/*.ts' })).toBe('allow');
    expect(decide(policy(), 'Glob', { pattern: '../../**' })).toBe('deny');
  });
  it('requires every workDir level to allow the path', () => {
    const p = policy({ workDirSets: [['/work'], ['/work/repo/sub']] });
    expect(decide(p, 'Read', { file_path: '/work/repo/other' })).toBe('deny');
    expect(decide(p, 'Read', { file_path: '/work/repo/sub/a' })).toBe('allow');
  });
  it('does not restrict paths when no workDirs are configured', () => {
    expect(decide(policy({ workDirSets: [] }), 'Read', { file_path: '/etc/hosts' })).toBe('allow');
  });
});
