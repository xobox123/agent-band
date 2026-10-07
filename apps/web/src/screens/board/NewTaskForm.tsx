import { useState } from 'react';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import type { Agent, AgentGroup, NewTask, ProjectOption, Task, TaskPatch } from '../../data/types.ts';
import { isoToLocal, localToIso } from '../../lib/schedule.ts';
import {
  EMPTY_TASK_FIELDS,
  TaskFields,
  fromNewTask,
  taskFieldAlias,
  taskFieldErrors,
  toNewTask,
} from './TaskFields.tsx';
import type { TaskFieldsValue } from './TaskFields.tsx';

const LAST_PROJECT_KEY = 'agent-band:last-project';

function lastProject(projects: ProjectOption[]): string {
  try {
    const id = window.localStorage.getItem(LAST_PROJECT_KEY);
    return id && projects.some((p) => p.id === id) ? id : '';
  } catch {
    return '';
  }
}

function rememberProject(id: string): void {
  try {
    if (id) window.localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // The choice is only a convenience.
  }
}

interface CreateProps {
  agents: Agent[];
  groups: AgentGroup[];
  /** Projects a task can run in; the last used one is preselected. */
  projects?: ProjectOption[] | undefined;
  onSubmit: (task: NewTask) => Promise<void>;
  onCancel: () => void;
  /** Edit a backlog task instead of creating one. */
  task?: undefined;
  onSave?: undefined;
}

interface EditProps {
  agents: Agent[];
  groups: AgentGroup[];
  projects?: undefined;
  task: Task;
  onSave: (patch: TaskPatch) => Promise<void>;
  onCancel: () => void;
  onSubmit?: undefined;
}

type Props = CreateProps | EditProps;

export const DEFAULT_MAX_ATTEMPTS = 3;

type NewTaskInput = Parameters<typeof taskFieldErrors>[0] & { runAt?: string; maxAttempts?: number };

export function newTaskErrors(input: NewTaskInput): Record<string, string> {
  const e = taskFieldErrors(input);
  if (input.runAt) {
    const iso = localToIso(input.runAt);
    if (!iso) e['runAt'] = 'Run at is not a valid date and time.';
    else if (Date.parse(iso) <= Date.now()) e['runAt'] = 'Run at must be in the future.';
  }
  const attempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20)
    e['maxAttempts'] = 'Max attempts must be a whole number from 1 to 20.';
  return e;
}

export function validateNewTask(input: NewTaskInput): string | null {
  return Object.values(newTaskErrors(input))[0] ?? null;
}

function initialFields(task: Task | undefined): TaskFieldsValue {
  if (!task) return EMPTY_TASK_FIELDS;
  return fromNewTask({
    title: task.title,
    prompt: task.prompt,
    workDir: task.workDir,
    target: task.target,
    priority: task.priority,
    ...(task.mode ? { mode: task.mode } : {}),
  });
}

export function NewTaskForm(props: Props) {
  const { agents, groups, onCancel } = props;
  const editing = props.task;
  const [fields, setFields] = useState<TaskFieldsValue>(() => initialFields(editing));
  const projects = props.projects ?? [];
  const [projectId, setProjectId] = useState(() => lastProject(projects));
  const [kind, setKind] = useState<'task' | 'goal'>('task');
  const [approval, setApproval] = useState(true);
  const [runAt, setRunAt] = useState(() => (editing?.runAt ? isoToLocal(editing.runAt) : ''));
  const [maxAttempts, setMaxAttempts] = useState(String(editing?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const attempts = maxAttempts.trim() === '' ? Number.NaN : Number(maxAttempts);
  const errors = newTaskErrors({ ...fields, runAt, maxAttempts: attempts });
  const invalid = Object.keys(errors).length > 0;
  const goal = kind === 'goal';
  const pickable = goal ? agents.filter((a) => a.role === 'leader') : agents;

  const run = (job: () => Promise<void>) => {
    if (invalid) return;
    setPending(true);
    setError(null);
    job().catch((e: unknown) => {
      setError(e);
      setPending(false);
    });
  };

  const create = (draft: boolean) => {
    if (!props.onSubmit) return;
    const submit = props.onSubmit;
    const iso = localToIso(runAt);
    run(() => {
      rememberProject(projectId);
      return submit({
        ...toNewTask(fields),
        ...(projectId ? { projectId } : {}),
        ...(iso ? { runAt: iso } : {}),
        maxAttempts: attempts,
        draft,
        ...(goal
          ? { kind: 'goal' as const, approval: approval ? ('required' as const) : ('auto' as const) }
          : {}),
      });
    });
  };

  const save = () => {
    if (!props.onSave) return;
    const submit = props.onSave;
    const base = toNewTask(fields);
    const iso = localToIso(runAt);
    run(() =>
      submit({
        title: base.title,
        prompt: base.prompt,
        ...(base.workDir ? { workDir: base.workDir } : {}),
        target: base.target,
        priority: base.priority,
        mode: base.mode ?? null,
        runAt: iso ?? null,
        maxAttempts: attempts,
      }),
    );
  };

  return (
    <FormDialog
      title={editing ? `Edit ${editing.key}` : goal ? 'New goal' : 'New task'}
      submitLabel={editing ? 'Save changes' : 'Add to backlog'}
      {...(editing
        ? {}
        : {
            secondaryLabel: 'Create and start',
            onSecondary: () => {
              create(false);
            },
          })}
      pending={pending}
      error={error}
      errors={errors}
      fieldAlias={taskFieldAlias(fields.targetType)}
      onSubmit={
        editing
          ? save
          : () => {
              create(true);
            }
      }
      onCancel={onCancel}
    >
      {editing ? null : (
        <Field label="Type" help="A goal is planned and delegated by a leader agent.">
          <select
            className="field"
            aria-label="Type"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'task' | 'goal');
            }}
          >
            <option value="task">Task</option>
            <option value="goal">Goal for a leader</option>
          </select>
        </Field>
      )}
      {goal ? (
        <div className="form-field form-check">
          <span className="form-label">Plan approval</span>
          <label className="check-row">
            <input
              type="checkbox"
              checked={approval}
              onChange={(e) => {
                setApproval(e.target.checked);
              }}
            />
            Require plan approval
          </label>
          <span className="form-help dim">
            The leader plans read-only and proposes subtasks; nothing runs until you approve.
          </span>
        </div>
      ) : null}
      {editing || projects.length === 0 ? null : (
        <Field
          label="Project"
          help="The task gets its own git worktree and branch in the project's repository."
        >
          <select
            className="field"
            aria-label="Project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
            }}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {`${p.name} (${p.defaultBranch})`}
              </option>
            ))}
          </select>
        </Field>
      )}
      <TaskFields value={fields} onChange={setFields} agents={pickable} groups={groups} />
      <Field label="Run at (optional)" name="runAt" help="Leave blank to run as soon as it is started.">
        <input
          className="field"
          type="datetime-local"
          value={runAt}
          onChange={(e) => {
            setRunAt(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Max attempts"
        name="maxAttempts"
        help="Automatic resumes after a rate limit stop at this count (1 to 20)."
      >
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
