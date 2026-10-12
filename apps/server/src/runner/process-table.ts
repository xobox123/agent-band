import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessIdentity {
  pid: number;
  pgid: number;
  startedAt: string;
  command: string;
}

export interface ProcessTable {
  read(pid: number): Promise<ProcessIdentity | null>;
  signalGroup(pgid: number, signal: NodeJS.Signals): void;
  waitForExit(identity: ProcessIdentity, timeoutMs: number): Promise<boolean>;
}

const sameProcess = (a: ProcessIdentity, b: ProcessIdentity): boolean =>
  a.pid === b.pid && a.pgid === b.pgid && a.startedAt === b.startedAt && a.command === b.command;

export function matchesProcess(expected: ProcessIdentity, actual: ProcessIdentity | null): boolean {
  return actual !== null && sameProcess(expected, actual);
}

const psLine =
  /^\s*(\d+)\s+(\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/;

export function parseProcessLine(line: string): ProcessIdentity {
  const match = psLine.exec(line);
  if (!match) throw new Error('Unrecognized ps process identity output');
  const [, pid, pgid, startedAt, command] = match;
  if (!pid || !pgid || !startedAt || !command) throw new Error('Incomplete ps process identity');
  return { pid: Number(pid), pgid: Number(pgid), startedAt, command };
}

/** ps lstart and comm work on macOS and Linux, unlike Linux-only /proc. */
export const systemProcessTable: ProcessTable = {
  async read(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process PID');
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        'ps',
        ['-p', String(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'comm='],
        { timeout: 3000, env: { ...process.env, LC_ALL: 'C' } },
      ));
    } catch (err) {
      const e = err as Error & { code?: number; stderr?: string };
      if (e.code === 1 && !e.stderr?.trim()) return null;
      throw err;
    }
    if (!stdout.trim()) return null;
    return parseProcessLine(stdout.trim());
  },
  signalGroup(pgid, signal) {
    if (!Number.isSafeInteger(pgid) || pgid <= 0) throw new Error('Invalid process group');
    process.kill(-pgid, signal);
  },
  async waitForExit(identity, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!matchesProcess(identity, await this.read(identity.pid))) return true;
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    }
  },
};

export type CleanupResult = 'terminated' | 'gone' | 'mismatch';

/**
 * Never signal a reused PID or a group that is not led by the recorded CLI.
 * A mismatched process is left for manual inspection instead of killing an unrelated process.
 */
export async function terminateRecordedGroup(
  expected: ProcessIdentity,
  table: ProcessTable,
  graceMs = 5000,
): Promise<CleanupResult> {
  const before = await table.read(expected.pid);
  if (!before) return 'gone';
  if (expected.pgid !== expected.pid || !matchesProcess(expected, before)) return 'mismatch';
  try {
    table.signalGroup(expected.pgid, 'SIGTERM');
  } catch (err) {
    if (!(await table.read(expected.pid))) return 'gone';
    throw err;
  }
  if (await table.waitForExit(expected, graceMs)) return 'terminated';
  const after = await table.read(expected.pid);
  if (!after) return 'terminated';
  if (!matchesProcess(expected, after)) return 'mismatch';
  try {
    table.signalGroup(expected.pgid, 'SIGKILL');
  } catch (err) {
    if (!(await table.read(expected.pid))) return 'terminated';
    throw err;
  }
  return 'terminated';
}
