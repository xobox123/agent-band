const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const CRON_PRESETS = [
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 9:00', cron: '0 9 * * *' },
  { label: 'Weekdays 9:00', cron: '0 9 * * 1-5' },
  { label: 'Monday 9:00', cron: '0 9 * * 1' },
];

const num = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);
const pad = (n: number) => String(n).padStart(2, '0');
const plural = (n: number, unit: string) => `Every ${String(n)} ${unit}${n === 1 ? '' : 's'}`;

function describeDays(field: string): string | null {
  if (field === '1-5') return 'weekdays';
  if (field === '0,6' || field === '6,0' || field === '6,7') return 'weekends';
  const parts = field.split(',');
  const days: number[] = [];
  for (const part of parts) {
    const n = num(part);
    if (n === null || n > 7) return null;
    days.push(n % 7);
  }
  if (days.length === 1) return `${DAYS[days[0] ?? 0] ?? ''}s`;
  return days.map((d) => (DAYS[d] ?? '').slice(0, 3)).join(', ');
}

/** Describes common five-field cron patterns in words; returns the raw expression otherwise. */
export function describeCron(expression: string): string {
  const raw = expression.trim();
  const f = raw.split(/\s+/);
  if (f.length !== 5) return raw;
  const [min = '', hour = '', dom = '', mon = '', dow = ''] = f;
  const minute = num(min);
  const hours = num(hour);
  const step = (s: string) => /^\*\/(\d+)$/.exec(s)?.[1];

  if (mon !== '*') return raw;
  if (min === '*' && hour === '*' && dom === '*' && dow === '*') return 'Every minute';
  if (hour === '*' && dom === '*' && dow === '*') {
    const n = step(min);
    if (n) return plural(Number(n), 'minute');
    if (minute !== null && minute < 60) return minute === 0 ? 'Every hour' : `Every hour at :${pad(minute)}`;
    return raw;
  }
  if (minute === null || minute > 59) return raw;
  if (dom === '*' && dow === '*') {
    const n = step(hour);
    if (n) return `${plural(Number(n), 'hour')}${minute === 0 ? '' : ` at :${pad(minute)}`}`;
  }
  if (hours === null || hours > 23) return raw;
  const at = `${pad(hours)}:${pad(minute)}`;
  if (dom === '*' && dow === '*') return `Every day at ${at}`;
  if (dom === '*') {
    const days = describeDays(dow);
    if (!days) return raw;
    return days === 'weekdays' || days === 'weekends'
      ? `Every ${days.slice(0, -1)} at ${at}`
      : `${days.includes(',') ? '' : 'Every '}${days} at ${at}`;
  }
  const day = num(dom);
  if (dow === '*' && day !== null && day >= 1 && day <= 31) return `Monthly on day ${String(day)} at ${at}`;
  return raw;
}

/** "in 2h 5m", "in 3 days"; "now" for past or imminent times. */
export function formatRelative(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return iso;
  if (ms < 30_000) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${String(hours)}h ${String(minutes % 60)}m`;
  const days = Math.floor(hours / 24);
  return `in ${String(days)} day${days === 1 ? '' : 's'}`;
}

/** Local HH:MM. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Weekday and date-time in the given IANA zone; falls back to local time. */
export function formatInZone(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return date.toLocaleString('en-GB', timeZone ? { ...options, timeZone } : options);
  } catch {
    return date.toLocaleString('en-GB', options);
  }
}

/** Value of a datetime-local input (local wall time) to an ISO string, or null when empty or invalid. */
export function localToIso(value: string): string | null {
  if (value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** ISO string to the value of a datetime-local input (local wall time). */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
