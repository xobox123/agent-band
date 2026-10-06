import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { NormalizedEvent, RunHandle } from '@agent-band/contracts';

export function eventQueue() {
  const queue: NormalizedEvent[] = [];
  const state = { ended: false };
  let wake: (() => void) | undefined;
  return {
    push(event: NormalizedEvent) {
      queue.push(event);
      wake?.();
    },
    end() {
      state.ended = true;
      wake?.();
    },
    events: (async function* () {
      while (!state.ended || queue.length) {
        const event = queue.shift();
        if (event) yield event;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
    })(),
  };
}
export function spawnJsonLines(
  spec: { cmd: string; args: string[]; cwd: string; env: Record<string, string | undefined> },
  parseLine: (line: string) => NormalizedEvent[],
  onExit?: () => Promise<NormalizedEvent[]>,
): RunHandle {
  const queue = eventQueue();
  const child = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error: string | undefined;
  let closed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on('line', (line) => {
    try {
      for (const event of parseLine(line)) queue.push(event);
    } catch {
      queue.push({ kind: 'stderr', text: line });
    }
  });
  stderr.on('line', (text) => {
    queue.push({ kind: 'stderr', text });
  });
  child.on('error', (err: NodeJS.ErrnoException) => {
    error = err.code === 'ENOENT' ? `${spec.cmd} not found in PATH` : err.message;
    queue.push({ kind: 'error', message: error });
  });
  const done = new Promise<Awaited<RunHandle['done']>>((resolve) => {
    child.on('close', (exitCode) => {
      closed = true;
      clearTimeout(killTimer);
      void (async () => {
        try {
          for (const event of (await onExit?.()) ?? []) queue.push(event);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          queue.push({ kind: 'error', message: error });
        }
        queue.end();
        resolve({
          exitCode: error && child.pid === undefined ? null : exitCode,
          ...(error ? { error } : {}),
        });
      })();
    });
  });
  return {
    events: queue.events,
    done,
    cancel() {
      if (closed || killTimer) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 5000);
    },
  };
}
