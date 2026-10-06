import { describe, expect, it } from 'vitest';
import { agentAllowed, capSubtaskMode, effectiveLimit } from './rules.ts';
import { buildContinuationPrompt } from './continuation.ts';

const agent = { id: 'a1', labels: ['be', 'ts'], groupIds: ['g1'] };

describe('agentAllowed', () => {
  it('allows everything without targets', () => {
    expect(agentAllowed(undefined, agent)).toBe(true);
    expect(agentAllowed({}, agent)).toBe(true);
  });
  it('requires every set dimension to match', () => {
    expect(agentAllowed({ agentIds: ['a1'] }, agent)).toBe(true);
    expect(agentAllowed({ agentIds: ['a2'] }, agent)).toBe(false);
    expect(agentAllowed({ labels: ['ts', 'x'] }, agent)).toBe(true);
    expect(agentAllowed({ labels: ['x'] }, agent)).toBe(false);
    expect(agentAllowed({ groupIds: ['g2'] }, agent)).toBe(false);
    expect(agentAllowed({ labels: ['be'], groupIds: ['g2'] }, agent)).toBe(false);
    expect(agentAllowed({ agentIds: [] }, agent)).toBe(false);
  });
});

describe('capSubtaskMode', () => {
  it('never exceeds the leader cap or run mode', () => {
    expect(capSubtaskMode('full-auto', 'edit', 'edit')).toBe('edit');
    expect(capSubtaskMode(undefined, 'edit', 'full-auto')).toBe('edit');
    expect(capSubtaskMode('full-auto', 'full-auto', 'edit')).toBe('edit');
    expect(capSubtaskMode('read-only', 'edit', 'edit')).toBe('read-only');
    expect(capSubtaskMode('edit', 'read-only', 'full-auto')).toBe('read-only');
  });
});

describe('effectiveLimit', () => {
  it('takes the minimum of the defined values', () => {
    expect(effectiveLimit(5, 3)).toBe(3);
    expect(effectiveLimit(undefined, 3)).toBe(3);
    expect(effectiveLimit(5, undefined)).toBe(5);
    expect(effectiveLimit(undefined, undefined)).toBeUndefined();
  });
});

describe('buildContinuationPrompt', () => {
  it('lists child results', () => {
    const p = buildContinuationPrompt({
      goalPrompt: 'Ship it',
      round: 2,
      maxRounds: 5,
      children: [
        {
          key: 'AB-2',
          title: 'Build',
          kind: 'task',
          status: 'done',
          outcome: 'success',
          summary: 'built',
          dependsOn: [],
        },
        { key: 'AB-3', title: 'Test', kind: 'review', status: 'failed', error: 'boom', dependsOn: ['AB-2'] },
      ],
    });
    expect(p).toContain('Ship it');
    expect(p).toContain('turn 2 of at most 5');
    expect(p).toContain('[AB-2] Build (task)');
    expect(p).toContain('summary: built');
    expect(p).toContain('depends on: AB-2');
    expect(p).toContain('error: boom');
    expect(p).toContain('complete_goal');
  });
});
