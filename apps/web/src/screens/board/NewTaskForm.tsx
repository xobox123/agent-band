import { useState } from 'react';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import type { Agent, AgentGroup, NewTask, Priority } from '../../data/types.ts';
import { PRIORITIES } from './model.ts';

type TargetType = 'agent' | 'label' | 'group';
type Mode = '' | 'read-only' | 'edit' | 'full-auto';

interface Props {
  agents: Agent[];
  groups: AgentGroup[];
  onSubmit: (task: NewTask) => Promise<void>;
  onCancel: () => void;
}

export function validateNewTask(input: {
  title: string;
  prompt: string;
  workDir: string;
  targetType: TargetType;
  agentId: string;
  label: string;
  groupId: string;
}): string | null {
  if (input.title.trim() === '') return 'Title is required.';
  if (input.prompt.trim() === '') return 'Prompt is required.';
  if (
    !input.workDir.startsWith('/') ||
    input.workDir.includes('\0') ||
    input.workDir.split('/').includes('..')
  ) {
    return 'Work directory must be an absolute path without .. segments.';
  }
  if (input.targetType === 'agent' && input.agentId === '') return 'Select an agent.';
  if (input.targetType === 'label' && input.label.trim() === '') return 'Enter a label.';
  if (input.targetType === 'group' && input.groupId === '') return 'Select a group.';
  return null;
}

export function NewTaskForm({ agents, groups, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('agent');
  const [agentId, setAgentId] = useState('');
  const [label, setLabel] = useState('');
  const [groupId, setGroupId] = useState('');
  const [priority, setPriority] = useState<Priority>(2);
  const [mode, setMode] = useState<Mode>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  const invalid = validateNewTask({ title, prompt, workDir, targetType, agentId, label, groupId });

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    const target: NewTask['target'] =
      targetType === 'agent'
        ? { type: 'agent', agentId }
        : targetType === 'label'
          ? { type: 'label', label: label.trim() }
          : { type: 'group', agentGroupId: groupId };
    setPending(true);
    setError(null);
    onSubmit({
      title: title.trim(),
      prompt,
      workDir,
      target,
      priority,
      ...(mode ? { mode } : {}),
    }).catch((e: unknown) => {
      setError(e);
      setPending(false);
    });
  };

  return (
    <FormDialog
      title="New task"
      submitLabel="Create task"
      pending={pending}
      error={error}
      invalid={touched ? invalid : null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Title" help="A short description shown on the board.">
        <input
          className="field"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </Field>
      <Field label="Work directory" help="Must be inside the agent's effective policy work directories.">
        <input
          className="field mono"
          value={workDir}
          placeholder="/path/to/repo"
          onChange={(e) => {
            setWorkDir(e.target.value);
          }}
        />
      </Field>
      <div className="wide form-field">
        <Field label="Prompt" help="Instructions passed to the agent.">
          <textarea
            className="field"
            rows={5}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="Target type">
        <select
          className="field"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value as TargetType);
          }}
        >
          <option value="agent">Agent</option>
          <option value="label">Label</option>
          <option value="group">Group</option>
        </select>
      </Field>
      {targetType === 'agent' ? (
        <Field label="Agent" help="An ineligible agent causes a denied task.">
          <select
            className="field"
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
            }}
          >
            <option value="">Select an agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.enabled ? a.name : `${a.name} (disabled)`}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {targetType === 'label' ? (
        <Field label="Label" help="Matching agents are evaluated individually.">
          <input
            className="field"
            value={label}
            maxLength={63}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
          />
        </Field>
      ) : null}
      {targetType === 'group' ? (
        <Field label="Group" help="Uses an eligible member without silent cross-account failover.">
          <select
            className="field"
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
            }}
          >
            <option value="">Select a group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Priority" help="P0 is highest; equal priorities follow manual rank.">
        <select
          className="field"
          value={priority}
          onChange={(e) => {
            setPriority(Number(e.target.value) as Priority);
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{`P${String(p)}`}</option>
          ))}
        </select>
      </Field>
      <Field label="Mode (optional)" help="Capped by the effective maxMode; blank uses the effective cap.">
        <select
          className="field"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as Mode);
          }}
        >
          <option value="">Effective cap</option>
          <option value="read-only">read-only</option>
          <option value="edit">edit</option>
          <option value="full-auto">full-auto</option>
        </select>
      </Field>
    </FormDialog>
  );
}
