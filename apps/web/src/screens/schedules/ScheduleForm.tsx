import type {
  CreateScheduleBody,
  ScheduleDto,
  ScheduleOverlap,
  UpdateScheduleBody,
} from '@agent-band/contracts';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { toGroup, toAgent, toTarget, toTargetDto } from '../../data/adapt.ts';
import { Field, FormDialog } from '../../components/FormDialog.tsx';
import type { Agent, AgentGroup, Priority } from '../../data/types.ts';
import { CRON_PRESETS, describeCron, formatInZone } from '../../lib/schedule.ts';
import {
  EMPTY_TASK_FIELDS,
  TaskFields,
  fromNewTask,
  toNewTask,
  taskFieldAlias,
  taskFieldErrors,
} from '../board/TaskFields.tsx';
import type { TaskFieldsValue } from '../board/TaskFields.tsx';

interface Props {
  schedule?: ScheduleDto | undefined;
  agents: Agent[];
  groups: AgentGroup[];
  orgTimezone: string;
  pending: boolean;
  error: unknown;
  onCreate: (body: CreateScheduleBody) => void;
  onUpdate: (id: string, body: UpdateScheduleBody) => void;
  onCancel: () => void;
}

export function agentsFor(items: Parameters<typeof toAgent>[0][]): Agent[] {
  return items.map((a) => toAgent(a));
}
export const groupsFor = (items: Parameters<typeof toGroup>[0][]): AgentGroup[] => items.map(toGroup);

type Preview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; times: string[] }
  | { state: 'error'; message: string };

function initialFields(schedule: ScheduleDto | undefined): TaskFieldsValue {
  if (!schedule) return EMPTY_TASK_FIELDS;
  const t = schedule.template;
  return fromNewTask({
    title: t.title,
    prompt: t.prompt,
    workDir: t.workDir,
    target: toTarget(t.target),
    priority: t.priority as Priority,
    ...(t.mode ? { mode: t.mode } : {}),
  });
}

export function ScheduleForm({
  schedule,
  agents,
  groups,
  orgTimezone,
  pending,
  error,
  onCreate,
  onUpdate,
  onCancel,
}: Props) {
  const api = useApi();
  const [name, setName] = useState(schedule?.name ?? '');
  const [cron, setCron] = useState(schedule?.cron ?? '0 9 * * 1-5');
  const [timezone, setTimezone] = useState(schedule?.timezone ?? '');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [overlap, setOverlap] = useState<ScheduleOverlap>(schedule?.overlap ?? 'skip');
  const [fields, setFields] = useState<TaskFieldsValue>(() => initialFields(schedule));
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const seq = useRef(0);

  const zone = timezone.trim();
  useEffect(() => {
    const expression = cron.trim();
    if (expression === '') {
      setPreview({ state: 'idle' });
      return;
    }
    const id = ++seq.current;
    setPreview({ state: 'loading' });
    const timer = setTimeout(() => {
      api.schedules.preview(expression, zone || undefined).then(
        (result) => {
          if (id === seq.current) setPreview({ state: 'ok', times: result.fireTimes });
        },
        (e: unknown) => {
          if (id === seq.current)
            setPreview({ state: 'error', message: e instanceof Error ? e.message : errorMessage(e) });
        },
      );
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [api, cron, zone]);

  const errors: Record<string, string> = {};
  if (name.trim() === '') errors['name'] = 'Name is required.';
  if (cron.trim() === '') errors['cron'] = 'Cron expression is required.';
  if (preview.state === 'error' && cron.trim() !== '') errors['cron'] = preview.message;
  Object.assign(errors, taskFieldErrors(fields));
  const invalid = Object.keys(errors).length > 0;

  const submit = () => {
    if (invalid) return;
    const task = toNewTask(fields);
    const template = {
      title: task.title,
      prompt: task.prompt,
      ...(task.workDir ? { workDir: task.workDir } : {}),
      target: toTargetDto(task.target),
      priority: task.priority,
      ...(task.mode ? { mode: task.mode } : {}),
    };
    if (schedule) {
      onUpdate(schedule.id, {
        name: name.trim(),
        enabled,
        cron: cron.trim(),
        timezone: zone || null,
        template,
        overlap,
      });
    } else {
      onCreate({
        name: name.trim(),
        enabled,
        cron: cron.trim(),
        ...(zone ? { timezone: zone } : {}),
        template,
        overlap,
      });
    }
  };

  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  return (
    <FormDialog
      title={schedule ? 'Edit schedule' : 'New schedule'}
      submitLabel={schedule ? 'Save schedule' : 'Create schedule'}
      pending={pending}
      error={error}
      errors={errors}
      fieldAlias={taskFieldAlias(fields.targetType)}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Name" name="name" required>
        <input
          className="field"
          value={name}
          maxLength={200}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Cron expression"
        name="cron"
        required
        help={`Five fields: minute hour day month weekday. ${describeCron(cron)}.`}
      >
        <input
          className="field mono"
          value={cron}
          placeholder="0 9 * * 1-5"
          onChange={(e) => {
            setCron(e.target.value);
          }}
        />
      </Field>
      <div className="wide">
        <div className="chips" role="group" aria-label="Cron presets">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              className="btn"
              aria-pressed={cron.trim() === p.cron}
              onClick={() => {
                setCron(p.cron);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <Field
        label="Time zone"
        name="timezone"
        help={`Blank uses the organization time zone (${orgTimezone}).`}
      >
        <input
          className="field"
          list="timezone-options"
          value={timezone}
          placeholder={orgTimezone}
          onChange={(e) => {
            setTimezone(e.target.value);
          }}
        />
        <datalist id="timezone-options">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
      <div className="wide">
        <div className="schedule-preview" aria-live="polite" aria-label="Next fire times">
          <span className="form-label">Next fire times</span>
          {preview.state === 'ok' ? (
            <ol className="preview-list">
              {preview.times.map((t) => (
                <li key={t}>{formatInZone(t, zone || orgTimezone)}</li>
              ))}
            </ol>
          ) : preview.state === 'error' ? (
            <p className="dim">No preview for this expression.</p>
          ) : (
            <p className="dim">
              {preview.state === 'loading' ? 'Calculating...' : 'Enter a cron expression.'}
            </p>
          )}
        </div>
      </div>
      <Field
        label="Overlap"
        name="overlap"
        help="What happens when the previous task is still active at the next fire time."
      >
        <select
          className="field"
          value={overlap}
          onChange={(e) => {
            setOverlap(e.target.value as ScheduleOverlap);
          }}
        >
          <option value="skip">Skip the new run</option>
          <option value="queue">Queue the new run</option>
        </select>
      </Field>
      <label className="form-field form-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
        <span className="form-label">Enabled</span>
      </label>
      <div className="wide">
        <h3 className="section-title">Task template</h3>
      </div>
      <TaskFields value={fields} onChange={setFields} agents={agents} groups={groups} />
    </FormDialog>
  );
}
