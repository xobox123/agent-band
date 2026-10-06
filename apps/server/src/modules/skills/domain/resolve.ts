export type SkillScope = { org: true } | { agentGroupId: string } | { agentId: string };

export interface AssignmentRow {
  skillId: string;
  pinnedVersion: number | null;
  level: 'org' | 'group' | 'agent';
}

const RANK = { org: 0, group: 1, agent: 2 } as const;

/** One entry per skill; the most specific level decides the pin. */
export function resolveAssignments(rows: AssignmentRow[]): Map<string, number | null> {
  const best = new Map<string, AssignmentRow>();
  for (const r of rows) {
    const cur = best.get(r.skillId);
    if (!cur || RANK[r.level] > RANK[cur.level]) best.set(r.skillId, r);
  }
  return new Map([...best].map(([id, r]) => [id, r.pinnedVersion]));
}

export function scopeToColumns(
  scope: SkillScope,
  orgId: string,
): { kind: 'org' | 'group' | 'agent'; id: string } {
  if ('org' in scope) return { kind: 'org', id: orgId };
  if ('agentGroupId' in scope) return { kind: 'group', id: scope.agentGroupId };
  return { kind: 'agent', id: scope.agentId };
}

export function columnsToScope(kind: string, id: string): SkillScope {
  if (kind === 'org') return { org: true };
  if (kind === 'group') return { agentGroupId: id };
  return { agentId: id };
}
