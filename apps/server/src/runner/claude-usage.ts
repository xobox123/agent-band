import type { LimitWindowInfo } from './probe.ts';

export interface ClaudeUsage {
  windows: LimitWindowInfo[];
  /** Extra weekly windows, for example "Sonnet". */
  perModel: { label: string; usedPercent: number; resetsAt: string | null }[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - (at - (at % 1000));
}

/** The instant at which the wall clock in `timeZone` shows the given date and time. */
function zonedInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): number | null {
  const wall = Date.UTC(y, mo, d, h, mi);
  try {
    const first = wall - zoneOffsetMs(wall, timeZone);
    return wall - zoneOffsetMs(first, timeZone);
  } catch {
    return null;
  }
}

function localParts(now: Date, timeZone: string): { y: number; mo: number; d: number } | null {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(now)
        .map((x) => [x.type, Number(x.value)]),
    ) as Record<string, number>;
    return { y: p.year ?? 1970, mo: (p.month ?? 1) - 1, d: p.day ?? 1 };
  } catch {
    return null;
  }
}

/** Parses "Oct 7 at 12:20pm", "2am", "12:20pm" (today or tomorrow) and "in 3h 5m". */
export function parseResetTime(text: string, timeZone: string, now: Date): string | null {
  const rel = /^in\s+(?:(\d+)\s*d\w*)?\s*(?:(\d+)\s*h\w*)?\s*(?:(\d+)\s*m\w*)?$/i.exec(text.trim());
  if (rel && (rel[1] || rel[2] || rel[3])) {
    const ms = (Number(rel[1] ?? 0) * 24 * 60 + Number(rel[2] ?? 0) * 60 + Number(rel[3] ?? 0)) * 60_000;
    return new Date(now.getTime() + ms).toISOString();
  }
  const m = /^(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(
    text.trim(),
  );
  if (!m) return null;
  const today = localParts(now, timeZone);
  if (!today) return null;
  let h = Number(m[3]) % 12;
  if (m[5]?.toLowerCase() === 'pm') h += 12;
  const mi = Number(m[4] ?? 0);
  if (m[1] && m[2]) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo < 0) return null;
    let t = zonedInstant(today.y, mo, Number(m[2]), h, mi, timeZone);
    if (t !== null && t < now.getTime() - 24 * 3_600_000)
      t = zonedInstant(today.y + 1, mo, Number(m[2]), h, mi, timeZone);
    return t === null ? null : new Date(t).toISOString();
  }
  let t = zonedInstant(today.y, today.mo, today.d, h, mi, timeZone);
  if (t !== null && t <= now.getTime()) t = zonedInstant(today.y, today.mo, today.d + 1, h, mi, timeZone);
  return t === null ? null : new Date(t).toISOString();
}

/** Parses the text that `claude -p "/usage"` prints; unknown lines are ignored. */
export function parseClaudeUsageText(text: string, now = new Date()): ClaudeUsage {
  const usage: ClaudeUsage = { windows: [], perModel: [] };
  for (const raw of text.split('\n')) {
    const m =
      /^\s*(Current session|Current week)(?:\s*\(([^)]*)\))?:\s*(\d+(?:\.\d+)?)%\s*used(?:\s*[·|-]\s*resets\s+(.*?))?\s*$/i.exec(
        raw,
      );
    if (!m) continue;
    const [, kind, label, percent, resetPart] = m;
    let resetsAt: string | null = null;
    if (resetPart) {
      const zone = /\(([A-Za-z_]+\/[A-Za-z_/+-]+|UTC)\)\s*$/.exec(resetPart);
      const when = resetPart.replace(/\s*\([^)]*\)\s*$/, '');
      resetsAt = parseResetTime(when, zone?.[1] ?? 'UTC', now);
    }
    const usedPercent = Number(percent);
    if (/session/i.test(kind ?? '')) usage.windows.push({ window: '5h', usedPercent, resetsAt });
    else if (!label || /all models/i.test(label))
      usage.windows.push({ window: 'weekly', usedPercent, resetsAt });
    else usage.perModel.push({ label, usedPercent, resetsAt });
  }
  return usage;
}
