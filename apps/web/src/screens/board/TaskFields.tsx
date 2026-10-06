import { Field } from '../../components/FormDialog.tsx';
import type { Agent, AgentGroup, NewTask, Priority } from '../../data/types.ts';
import { PRIORITIES } from './model.ts';

export type TargetType = 'agent' | 'label' | 'group';
export type Mode = '' | 'read-only' | 'edit' | 'full-auto';

export interface TaskFieldsValue {
  title: string;
  prompt: string;
  workDir: string;
  targetType: TargetType;
  agentId: string;
  label: string;
  groupId: string;
  priority: Priority;
  mode: Mode;
}

export const EMPTY_TASK_FIELDS: TaskFieldsValue = {
  title: '',
  prompt: '',
  workDir: '',
  targetType: 'agent',
  agentId: '',
  label: '',
  groupId: '',
  priority: 2,
  mode: '',
};

export function validateTaskFields(
  input: Pick<
    TaskFieldsValue,
    'title' | 'prompt' | 'workDir' | 'targetType' | 'agentId' | 'label' | 'groupId'
  >,
): string | null {
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

export function toNewTask(value: TaskFieldsValue): NewTask {
  const target: NewTask['target'] =
    value.targetType === 'agent'
      ? { type: 'agent', agentId: value.agentId }
      : value.targetType === 'label'
        ? { type: 'label', label: value.label.trim() }
        : { type: 'group', agentGroupId: value.groupId };
  return {
    title: value.title.trim(),
    prompt: value.prompt,
    workDir: value.workDir,
    target,
    priority: value.priority,
    ...(value.mode ? { mode: value.mode } : {}),
  };
}

export function fromNewTask(task: NewTask): TaskFieldsValue {
  return {
    ...EMPTY_TASK_FIELDS,
    title: task.title,
    prompt: task.prompt,
    workDir: task.workDir,
    priority: task.priority,
    mode: task.mode ?? '',
    targetType: task.target.type,
    agentId: task.target.type === 'agent' ? task.target.agentId : '',
    label: task.target.type === 'label' ? task.target.label : '',
    groupId: task.target.type === 'group' ? task.target.agentGroupId : '',
  };
}

interface Props {
  value: TaskFieldsValue;
  onChange: (value: TaskFieldsValue) => void;
  agents: Agent[];
  groups: AgentGroup[];
}

/** Task template fields shared by the new task form and the schedule form. */
export function TaskFields({ value, onChange, agents, groups }: Props) {
  const set = <K extends keyof TaskFieldsValue>(key: K, next: TaskFieldsValue[K]) => {
    onChange({ ...value, [key]: next });
  };
  return (
    <>
      <Field label="Title" help="A short description shown on the board.">
        <input
          className="field"
          value={value.title}
          maxLength={200}
          onChange={(e) => {
            set('title', e.target.value);
          }}
        />
      </Field>
      <Field label="Work directory" help="Must be inside the agent's effective policy work directories.">
        <input
          className="field mono"
          value={value.workDir}
          placeholder="/path/to/repo"
          onChange={(e) => {
            set('workDir', e.target.value);
          }}
        />
      </Field>
      <div className="wide form-field">
        <Field label="Prompt" help="Instructions passed to the agent.">
          <textarea
            className="field"
            rows={5}
            value={value.prompt}
            onChange={(e) => {
              set('prompt', e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="Target type">
        <select
          className="field"
          value={value.targetType}
          onChange={(e) => {
            set('targetType', e.target.value as TargetType);
          }}
        >
          <option value="agent">Agent</option>
          <option value="label">Label</option>
          <option value="group">Group</option>
        </select>
      </Field>
      {value.targetType === 'agent' ? (
        <Field label="Agent" help="An ineligible agent causes a denied task.">
          <select
            className="field"
            value={value.agentId}
            onChange={(e) => {
              set('agentId', e.target.value);
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
      {value.targetType === 'label' ? (
        <Field label="Label" help="Matching agents are evaluated individually.">
          <input
            className="field"
            value={value.label}
            maxLength={63}
            onChange={(e) => {
              set('label', e.target.value);
            }}
          />
        </Field>
      ) : null}
      {value.targetType === 'group' ? (
        <Field label="Group" help="Uses an eligible member without silent cross-account failover.">
          <select
            className="field"
            value={value.groupId}
            onChange={(e) => {
              set('groupId', e.target.value);
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
          value={value.priority}
          onChange={(e) => {
            set('priority', Number(e.target.value) as Priority);
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
          value={value.mode}
          onChange={(e) => {
            set('mode', e.target.value as Mode);
          }}
        >
          <option value="">Effective cap</option>
          <option value="read-only">read-only</option>
          <option value="edit">edit</option>
          <option value="full-auto">full-auto</option>
        </select>
      </Field>
    </>
  );
}
