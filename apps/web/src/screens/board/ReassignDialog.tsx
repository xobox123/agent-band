import { useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { errorMessage } from '../../api/client.ts';
import type { Agent, AgentGroup, Task, TaskTarget } from '../../data/types.ts';

interface Props {
  task: Task;
  agents: Agent[];
  groups: AgentGroup[];
  onSave: (target: TaskTarget) => Promise<void>;
  onCancel: () => void;
}

/** Keep the task's worktree and schedule intact while choosing a new dispatch target. */
export function ReassignDialog({ task, agents, groups, onSave, onCancel }: Props) {
  const [type, setType] = useState<TaskTarget['type']>(task.target.type);
  const [agentId, setAgentId] = useState(task.target.type === 'agent' ? task.target.agentId : '');
  const [groupId, setGroupId] = useState(task.target.type === 'group' ? task.target.agentGroupId : '');
  const [label, setLabel] = useState(task.target.type === 'label' ? task.target.label : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target: TaskTarget =
    type === 'agent'
      ? { type, agentId }
      : type === 'group'
        ? { type, agentGroupId: groupId }
        : { type, label: label.trim() };
  const valid = type === 'agent' ? agentId !== '' : type === 'group' ? groupId !== '' : label.trim() !== '';
  const choices = task.kind === 'goal' ? agents.filter((a) => a.role === 'leader') : agents;

  return (
    <Dialog label={`Reassign ${task.key}`} onClose={() => { if (!busy) onCancel(); }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setError(null);
          void onSave(target).catch((reason: unknown) => {
            setError(errorMessage(reason));
            setBusy(false);
          });
        }}
      >
        <h2>Reassign {task.key}</h2>
        <p className="dim">Change the dispatch target without cancelling the task or deleting its worktree.</p>
        <label className="form-field">
          Target type
          <select
            className="field"
            aria-label="Reassign target type"
            value={type}
            disabled={busy}
            onChange={(event) => { setType(event.target.value as TaskTarget['type']); }}
          >
            <option value="agent">Agent</option>
            {task.kind !== 'goal' ? <option value="group">Group</option> : null}
            {task.kind !== 'goal' ? <option value="label">Label</option> : null}
          </select>
        </label>
        {type === 'agent' ? (
          <label className="form-field">
            Agent
            <select
              className="field"
              aria-label="Reassign agent"
              value={agentId}
              disabled={busy}
              onChange={(event) => { setAgentId(event.target.value); }}
            >
              <option value="">Select an agent</option>
              {choices.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}{!agent.enabled ? ' (disabled)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : type === 'group' ? (
          <label className="form-field">
            Group
            <select
              className="field"
              aria-label="Reassign group"
              value={groupId}
              disabled={busy}
              onChange={(event) => { setGroupId(event.target.value); }}
            >
              <option value="">Select a group</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
        ) : (
          <label className="form-field">
            Label
            <input
              className="field"
              aria-label="Reassign label"
              maxLength={63}
              value={label}
              disabled={busy}
              onChange={(event) => { setLabel(event.target.value); }}
            />
          </label>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="btn" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={!valid || busy}>
            {busy ? 'Reassigning...' : 'Reassign'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
