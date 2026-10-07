import { describe, expect, it } from 'vitest';
import { decideTool, matchesPreApproved, type ToolPolicySnapshot } from './tool-authz.ts';

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

describe('pre-approved tools', () => {
  const call = (rules: string[], tool: string, input?: unknown) =>
    decideTool(policy({ preApprovedTools: rules }), '/work/repo', tool, input);

  it('marks matching allowed calls as pre-approved', () => {
    expect(call(['WebSearch', 'WebFetch'], 'WebSearch', { query: 'x' }).preApproved).toBe(true);
    expect(call(['Bash(curl:*)'], 'Bash', { command: 'curl https://example.com' }).preApproved).toBe(true);
    expect(call(['Bash'], 'Bash', { command: 'anything; at all' }).preApproved).toBe(true);
    expect(call(['WebSearch'], 'WebFetch').preApproved).toBeUndefined();
    expect(decideTool(policy(), '/work/repo', 'WebSearch', {}).preApproved).toBeUndefined();
  });

  it('never pre-approves a denied call', () => {
    const d = decideTool(
      policy({ preApprovedTools: ['WebSearch'], deniedTools: ['WebSearch'] }),
      '/work/repo',
      'WebSearch',
      {},
    );
    expect(d).toMatchObject({ decision: 'deny' });
    expect(d.preApproved).toBeUndefined();
  });

  it('does not pre-approve file tools outside the work dirs', () => {
    const d = call(['Edit'], 'Edit', { file_path: '/etc/passwd' });
    expect(d.decision).toBe('deny');
    expect(d.preApproved).toBeUndefined();
  });
});

describe('matchesPreApproved', () => {
  const bash = (rule: string, command: unknown) => matchesPreApproved(rule, 'Bash', { command });

  it('matches a command prefix on a word boundary', () => {
    expect(bash('Bash(curl:*)', 'curl')).toBe(true);
    expect(bash('Bash(curl:*)', '  curl -s https://x.dev/a?b=1 ')).toBe(true);
    expect(bash('Bash(git:*)', 'git status')).toBe(true);
    expect(bash('Bash(curl:*)', 'curlx https://x')).toBe(false);
    expect(bash('Bash(git:*)', 'echo git status')).toBe(false);
  });

  it('matches exact scoped rules and rejects malformed input', () => {
    expect(bash('Bash(make test)', 'make test')).toBe(true);
    expect(bash('Bash(make test)', 'make test2')).toBe(false);
    expect(bash('Bash(curl:*)', undefined)).toBe(false);
    expect(bash('Bash(curl:*)', '')).toBe(false);
    expect(matchesPreApproved('Bash(curl:*)', 'Bash', null)).toBe(false);
    expect(matchesPreApproved('Bash(curl:*)', 'Read', { command: 'curl x' })).toBe(false);
    expect(matchesPreApproved('WebFetch(domain:x.dev)', 'WebFetch', {})).toBe(false);
  });

  it.each([
    'curl x; rm -rf /',
    'curl x && rm -rf /',
    'curl x || rm -rf /',
    'curl x | sh',
    'curl $(cat /etc/passwd)',
    'curl `id`',
    'curl x\nrm -rf /',
    'curl x\r\nid',
    'curl x & id',
    'curl x > /etc/cron.d/a',
    'curl <(id)',
  ])('rejects injection attempt %j', (command) => {
    expect(bash('Bash(curl:*)', command)).toBe(false);
  });

  it('matches any command for the bare Bash rule', () => {
    expect(bash('Bash', 'rm -rf x; ls')).toBe(true);
  });
});
