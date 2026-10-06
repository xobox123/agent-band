# agent-band: stage 2 design (scheduler and automatic resume)

Date: 2026-10-07. Builds on the stage 1 spec (`2026-10-06-agent-band-design.md`).

## Goal

Work keeps flowing without a human: tasks can be scheduled for later or on a
recurring basis, and tasks stopped by a provider limit resume automatically
when the limit window resets, without ever moving work to another account
silently.

## Scope

1. **Scheduled tasks (one-off)**: a task can have `runAt`; it stays in a new
   status `scheduled` and becomes `queued` at that time.
2. **Recurring schedules**: a `Schedule` entity creates a task from a
   template on a cron expression in the organisation timezone.
3. **Automatic resume after rate limits**: a `rate_limited` task becomes
   `queued` again at the account's block reset time (plus a small jitter),
   bounded by a per-task retry limit.
4. **Scheduler process role**: a `scheduler` loop that runs in role `api` or
   `all`, safe when several API instances run (single active leader).

Out of scope: dependencies between tasks (DAG), leader agent planning
(stage 3), calendar exceptions, notifications.

## Domain

```
Schedule (module "scheduler")
  id, orgId, name, enabled, cron (5 fields, validated), timezone? (default
  org timezone), template: { title, prompt, workDir, target, priority,
  mode? }, overlap: "skip" | "queue" (default "skip": do not create a new
  task while the previous one from this schedule is not terminal),
  lastFiredAt?, nextFireAt, createdBy, createdAt, updatedAt

Task (changes, module "tasks")
  status gains "scheduled"
  runAt?            when status = scheduled
  scheduleId?       set when created by a schedule (plain uuid, no FK)
  attempt (int, default 1), maxAttempts (default 3)
  resumeAt?         when status = rate_limited and auto resume is planned
```

## Behaviour

- Tick every 15 s (configurable). Each tick, inside one transaction holding
  `pg_try_advisory_xact_lock(hashtext('agent-band:scheduler'))`; if the lock
  is not acquired, another instance is the leader and the tick does nothing.
- **Due scheduled tasks**: `status = scheduled AND runAt <= now()` become
  `queued` (audited `task.release_scheduled`, actor `system:scheduler`).
- **Due schedules**: `enabled AND nextFireAt <= now()`: create a task from
  the template (normal `createTask` path, so policy and RBAC apply at run
  time as usual), respect `overlap`, set `lastFiredAt`, compute the next
  `nextFireAt` strictly after now (missed fires while the app was down are
  collapsed into one fire, not replayed). Audited `schedule.fire`.
- **Rate-limit resume**: when the worker ends a run as `rate_limited`, the
  task gets `resumeAt = account block until + jitter (0 to 60 s)` and stays
  `rate_limited`. The scheduler requeues tasks with `resumeAt <= now()` if
  `attempt < maxAttempts` (increments `attempt`, audited `task.resume`);
  otherwise the task goes to `failed` with "rate limit retries exhausted".
  Requeued tasks keep their original target; the no-silent-failover rule of
  the worker still applies.
- Cancelling a scheduled or rate-limited task clears `runAt`/`resumeAt`.
- Disabling a schedule never touches tasks it already created.
- A new principal `system:scheduler` is created by org bootstrap.

## API

- `POST /tasks` accepts optional `runAt` (ISO, future) and `maxAttempts`.
- `GET|POST /schedules`, `GET|PATCH|DELETE /schedules/:id`,
  `POST /schedules/:id/run-now` (creates a task immediately, does not move
  `nextFireAt`), `GET /schedules/:id/tasks`.
- `GET /schedules/preview?cron=&timezone=` returns the next 5 fire times.
- SSE: `schedule.updated`, existing `task.updated`.

## UI

- Board: a "Scheduled" column before Queued (collapsed when empty) showing
  `runAt`; rate-limited cards show "resumes at HH:MM (attempt n/m)".
- Schedules screen (sidebar under Workloads): table (name, cron in words,
  next fire, last fire, last task status, enabled), details panel with the
  template and the task history, create/edit form with a live preview of the
  next fire times.

## Testing

Cron parsing and next-fire computation across DST changes in Europe/Warsaw;
leader lock (two schedulers, one fires); overlap skip/queue; resume with
retry limit; scheduled release; API flows; UI render and form tests.
