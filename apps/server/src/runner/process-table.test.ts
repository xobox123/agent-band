import { describe, expect, it } from 'vitest';
import {
  matchesProcess,
  parseProcessLine,
  terminateRecordedGroup,
  type ProcessIdentity,
  type ProcessTable,
} from './process-table.ts';

const child: ProcessIdentity = {
  pid: 4100,
  pgid: 4100,
  startedAt: 'Mon Oct 12 12:00:00 2026',
  command: '/usr/local/bin/claude',
};

function fakeTable(initial: ProcessIdentity | null, stopOnTerm = true) {
  let current = initial;
  const sent: NodeJS.Signals[] = [];
  const table: ProcessTable = {
    async read(pid) {
      return current?.pid === pid ? current : null;
    },
    signalGroup(pgid, signal) {
      expect(pgid).toBe(child.pgid);
      sent.push(signal);
      if (stopOnTerm || signal === 'SIGKILL') current = null;
    },
    async waitForExit(expected) {
      return !matchesProcess(expected, current);
    },
  };
  return { table, sent };
}

describe('process group cleanup', () => {
  it('parses process start time and executable using portable ps output', () => {
    expect(
      parseProcessLine(' 4100 4100 Mon Oct 12 12:00:00 2026 /usr/local/bin/claude'),
    ).toEqual(child);
    expect(() => parseProcessLine('malformed')).toThrow('Unrecognized ps');
  });

  it('sends TERM to a matching process group and records successful exit', async () => {
    const { table, sent } = fakeTable(child);
    expect(await terminateRecordedGroup(child, table, 0)).toBe('terminated');
    expect(sent).toEqual(['SIGTERM']);
  });

  it('escalates to KILL when the process still lives after TERM', async () => {
    const { table, sent } = fakeTable(child, false);
    expect(await terminateRecordedGroup(child, table, 0)).toBe('terminated');
    expect(sent).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('never signals a recycled PID with another start time or command', async () => {
    for (const reuse of [
      { ...child, startedAt: 'Mon Oct 12 12:00:01 2026' },
      { ...child, command: '/usr/local/bin/not-claude' },
      { ...child, pgid: 999 },
    ]) {
      const { table, sent } = fakeTable(reuse);
      expect(await terminateRecordedGroup(child, table, 0)).toBe('mismatch');
      expect(sent).toEqual([]);
    }
  });

  it('refuses non-leader group ids and treats vanished processes as gone', async () => {
    const { table, sent } = fakeTable(child);
    expect(await terminateRecordedGroup({ ...child, pgid: child.pid + 1 }, table, 0)).toBe(
      'mismatch',
    );
    expect(sent).toEqual([]);
    expect(await terminateRecordedGroup(child, fakeTable(null).table, 0)).toBe('gone');
  });
});
