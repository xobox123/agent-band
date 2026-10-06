export interface SchedulerLoop {
  /** Stops scheduling new ticks and waits for the running one. */
  stop(): Promise<void>;
}

export const DEFAULT_TICK_MS = 15_000;

export function startSchedulerLoop(
  tick: () => Promise<unknown>,
  opts: { intervalMs?: number; onError?: (err: unknown) => void } = {},
): SchedulerLoop {
  const interval = opts.intervalMs ?? DEFAULT_TICK_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick()
        .then(() => undefined)
        .catch((err: unknown) => opts.onError?.(err))
        .finally(schedule);
    }, interval);
    timer.unref();
  };
  schedule();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
