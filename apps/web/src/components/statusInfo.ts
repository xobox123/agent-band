export type StatusKind = 'task' | 'run' | 'agent' | 'user' | 'indicator';

export interface StatusInfo {
  label: string;
  /** CSS custom property name of the dot colour. */
  token: '--ok' | '--accent' | '--warn' | '--crit' | '--muted' | '--text-dim';
}

const TABLE: Record<StatusKind, Record<string, StatusInfo>> = {
  task: {
    scheduled: { label: 'Scheduled', token: '--accent' },
    queued: { label: 'Queued', token: '--muted' },
    claimed: { label: 'Claimed', token: '--warn' },
    running: { label: 'Running', token: '--ok' },
    done: { label: 'Done', token: '--ok' },
    failed: { label: 'Failed', token: '--crit' },
    rate_limited: { label: 'Rate limited', token: '--warn' },
    cancelled: { label: 'Cancelled', token: '--text-dim' },
    denied: { label: 'Denied', token: '--crit' },
  },
  run: {
    running: { label: 'Running', token: '--ok' },
    done: { label: 'Done', token: '--ok' },
    failed: { label: 'Failed', token: '--crit' },
    rate_limited: { label: 'Rate limited', token: '--warn' },
    cancelled: { label: 'Cancelled', token: '--text-dim' },
  },
  agent: {
    running: { label: 'Running', token: '--ok' },
    idle: { label: 'Idle', token: '--muted' },
    blocked: { label: 'Blocked', token: '--warn' },
    enabled: { label: 'Enabled', token: '--ok' },
    disabled: { label: 'Disabled', token: '--text-dim' },
  },
  user: {
    active: { label: 'Active', token: '--ok' },
    disabled: { label: 'Disabled', token: '--text-dim' },
  },
  indicator: {
    available: { label: 'Available', token: '--ok' },
    concurrency_full: { label: 'Concurrency full', token: '--warn' },
    budget_exhausted: { label: 'Budget exhausted', token: '--warn' },
    rate_limited: { label: 'Rate limited', token: '--warn' },
    unknown: { label: 'Unknown', token: '--muted' },
    no_eligible_agent: { label: 'No eligible agent', token: '--warn' },
    connected: { label: 'Connected', token: '--ok' },
    connecting: { label: 'Connecting', token: '--muted' },
    idle: { label: 'Idle', token: '--muted' },
    blocked: { label: 'Blocked', token: '--warn' },
    ok: { label: 'Verified', token: '--ok' },
    broken: { label: 'Chain broken', token: '--crit' },
    reconnecting: { label: 'Reconnecting', token: '--warn' },
  },
};

export function statusInfo(kind: StatusKind, value: string): StatusInfo {
  return TABLE[kind][value] ?? { label: value, token: '--muted' };
}

export function statusValues(kind: StatusKind): string[] {
  return Object.keys(TABLE[kind]);
}
