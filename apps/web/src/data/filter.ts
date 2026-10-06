import type { Agent, BoardFilter, Run, Task } from './types.ts';

export function matchesFilter(
  task: Task,
  run: Run | undefined,
  agents: Map<string, Pick<Agent, 'id' | 'labels' | 'accountId'>>,
  filter: BoardFilter,
): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text && !task.key.toLowerCase().includes(text) && !task.title.toLowerCase().includes(text)) {
    return false;
  }
  const actual = run ? agents.get(run.agentId) : undefined;
  const explicit = task.target.type === 'agent' ? agents.get(task.target.agentId) : undefined;
  const agent = actual ?? explicit;

  if (filter.agentId && agent?.id !== filter.agentId) return false;
  if (filter.label) {
    const targetLabel = task.target.type === 'label' ? task.target.label : null;
    if (targetLabel !== filter.label && !actual?.labels.includes(filter.label)) return false;
  }
  if (filter.accountId) {
    const accountId = run?.accountId ?? explicit?.accountId;
    if (accountId !== filter.accountId) return false;
  }
  return true;
}
