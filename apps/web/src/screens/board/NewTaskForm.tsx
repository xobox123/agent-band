import { useState } from 'react';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import type { Agent, AgentGroup, NewTask } from '../../data/types.ts';
import { localToIso } from '../../lib/schedule.ts';
import { EMPTY_TASK_FIELDS, TaskFields, toNewTask, validateTaskFields } from './TaskFields.tsx';
import type { TaskFieldsValue, TargetType } from './TaskFields.tsx';

interface Props {
  agents: Agent[];
  groups: AgentGroup[];
  onSubmit: (task: NewTask) => Promise<void>;
  onCancel: () => void;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

export function validateNewTask(input: {
  title: string;
  prompt: string;
  workDir: string;
  targetType: TargetType;
  agentId: string;
  label: string;
  groupId: string;
  runAt?: string;
  maxAttempts?: number;
}): string | null {
  const fields = validateTaskFields(input);
  if (fields) return fields;
  if (input.runAt) {
    const iso = localToIso(input.runAt);
    if (!iso) return 'Run at is not a valid date and time.';
    if (Date.parse(iso) <= Date.now()) return 'Run at must be in the future.';
  }
  const attempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    return 'Max attempts must be a whole number from 1 to 20.';
  }
  return null;
}

export function NewTaskForm({ agents, groups, onSubmit, onCancel }: Props) {
  const [fields, setFields] = useState<TaskFieldsValue>(EMPTY_TASK_FIELDS);
  const [runAt, setRunAt] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(String(DEFAULT_MAX_ATTEMPTS));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  const attempts = maxAttempts.trim() === '' ? Number.NaN : Number(maxAttempts);
  const invalid = validateNewTask({ ...fields, runAt, maxAttempts: attempts });

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    const iso = localToIso(runAt);
    setPending(true);
    setError(null);
    onSubmit({ ...toNewTask(fields), ...(iso ? { runAt: iso } : {}), maxAttempts: attempts }).catch(
      (e: unknown) => {
        setError(e);
        setPending(false);
      },
    );
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
      <TaskFields value={fields} onChange={setFields} agents={agents} groups={groups} />
      <Field label="Run at (optional)" help="Leave blank to queue now. The task stays scheduled until then.">
        <input
          className="field"
          type="datetime-local"
          value={runAt}
          onChange={(e) => {
            setRunAt(e.target.value);
          }}
        />
      </Field>
      <Field label="Max attempts" help="Automatic resumes after a rate limit stop at this count (1 to 20).">
        <input
          className="field"
          type="number"
          min={1}
          max={20}
          step={1}
          value={maxAttempts}
          onChange={(e) => {
            setMaxAttempts(e.target.value);
          }}
        />
      </Field>
    </FormDialog>
  );
}
