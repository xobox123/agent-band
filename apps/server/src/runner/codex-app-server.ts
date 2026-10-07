import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cliCommand, missingCliMessage } from './cli-locator.ts';
import { object } from './parsers.ts';
import type { CliBins, LimitWindowInfo } from './probe.ts';

export interface RpcSession {
  request(method: string, params?: unknown): Promise<Record<string, unknown>>;
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void;
  close(): void;
}

export interface AppServerOptions {
  bins?: CliBins;
  timeoutMs?: number;
}

/** Spawns `codex app-server` (JSON-RPC 2.0 over stdio), handshakes, and hands a session to `fn`. */
export async function withCodexAppServer<T>(
  env: NodeJS.ProcessEnv,
  opts: AppServerOptions,
  fn: (rpc: RpcSession) => Promise<T>,
  keepAlive = false,
): Promise<T> {
  const bin = opts.bins?.openai;
  const child: ChildProcess = spawn(bin?.cmd ?? cliCommand('codex'), [...(bin?.args ?? []), 'app-server'], {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: true,
  });
  const kill = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };
  const pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  let handler: ((method: string, params: Record<string, unknown>) => void) | undefined;
  let nextId = 1;
  let failure: Error | undefined;
  const failAll = (err: Error) => {
    failure ??= err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  child.on('error', (err: NodeJS.ErrnoException) => {
    failAll(new Error(err.code === 'ENOENT' ? missingCliMessage('codex') : err.message));
  });
  child.on('close', () => {
    failAll(new Error('codex app-server exited'));
  });
  if (!child.stdout || !child.stdin) throw new Error('codex app-server has no stdio');
  child.stdin.on('error', () => undefined);
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg: Record<string, unknown>;
    try {
      msg = object(JSON.parse(line));
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && ('result' in msg || 'error' in msg)) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(str(object(msg.error).message) ?? 'request failed'));
      else p.resolve(object(msg.result));
    } else if (typeof msg.method === 'string') {
      handler?.(msg.method, object(msg.params));
    }
  });
  const send = (message: unknown) => child.stdin?.write(`${JSON.stringify(message)}\n`);
  const rpc: RpcSession = {
    request(method, params = {}) {
      if (failure) return Promise.reject(failure);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    onNotification(h) {
      handler = h;
    },
    close: kill,
  };
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`codex app-server did not answer within ${timeoutMs / 1000}s`));
    }, timeoutMs).unref();
  });
  try {
    return await Promise.race([
      (async () => {
        await rpc.request('initialize', { clientInfo: { name: 'agent-band', version: '0.1.0' } });
        send({ jsonrpc: '2.0', method: 'initialized' });
        return fn(rpc);
      })(),
      timeout,
    ]);
  } catch (err) {
    kill();
    throw err;
  } finally {
    if (!keepAlive) kill();
  }
}

export interface CodexAccountInfo {
  loggedIn: boolean;
  authType: string | null;
  email: string | null;
  plan: string | null;
}
export interface CodexUsageInfo {
  windows: LimitWindowInfo[];
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  ordinaryUsageAllowed: boolean | null;
  limitReached: boolean;
  planType: string | null;
  daily: { date: string; tokens: number }[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseCodexAccount(result: Record<string, unknown>): CodexAccountInfo {
  const account = object(result.account);
  const loggedIn = Object.keys(account).length > 0 && result.account !== null;
  return {
    loggedIn,
    authType: loggedIn ? str(account.type) : null,
    email: str(account.email),
    plan: str(account.planType),
  };
}

export function parseCodexRateLimits(result: Record<string, unknown>): Omit<CodexUsageInfo, 'daily'> {
  const limits = object(result.rateLimits);
  const windows: LimitWindowInfo[] = [];
  for (const [key, fallback] of [
    ['primary', '5h'],
    ['secondary', 'weekly'],
  ] as const) {
    const w = object(limits[key]);
    if (typeof w.usedPercent !== 'number') continue;
    const mins = typeof w.windowDurationMins === 'number' ? w.windowDurationMins : null;
    windows.push({
      window: mins === null ? fallback : mins <= 720 ? '5h' : 'weekly',
      usedPercent: w.usedPercent,
      resetsAt: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : null,
    });
  }
  const credits = limits.credits ? object(limits.credits) : null;
  return {
    windows,
    credits: credits
      ? {
          hasCredits: credits.hasCredits === true,
          unlimited: credits.unlimited === true,
          balance: str(credits.balance),
        }
      : null,
    ordinaryUsageAllowed:
      typeof result.ordinaryUsageAllowed === 'boolean' ? result.ordinaryUsageAllowed : null,
    limitReached: limits.rateLimitReachedType != null || windows.some((w) => w.usedPercent >= 100),
    planType: str(limits.planType),
  };
}

export function parseCodexDaily(result: Record<string, unknown>): { date: string; tokens: number }[] {
  const buckets = Array.isArray(result.dailyUsageBuckets) ? result.dailyUsageBuckets : [];
  return buckets
    .map((b) => object(b))
    .filter((b) => typeof b.startDate === 'string' && typeof b.tokens === 'number')
    .map((b) => ({ date: b.startDate as string, tokens: b.tokens as number }))
    .slice(-30);
}

/** Account, limits and token history through one app-server session; usage history is best effort. */
export async function readCodexNative(
  env: NodeJS.ProcessEnv,
  opts: AppServerOptions,
  want: { limits: boolean },
): Promise<{ account: CodexAccountInfo; usage: CodexUsageInfo | null }> {
  return withCodexAppServer(env, opts, async (rpc) => {
    const account = parseCodexAccount(await rpc.request('account/read', {}));
    if (!account.loggedIn || !want.limits) return { account, usage: null };
    const limits = parseCodexRateLimits(await rpc.request('account/rateLimits/read', {}));
    const daily = await rpc.request('account/usage/read', {}).then(parseCodexDaily, () => []);
    return { account, usage: { ...limits, daily } };
  });
}

/** Starts the ChatGPT browser login inside app-server; resolves once the URL exists. */
export async function startCodexNativeLogin(
  env: NodeJS.ProcessEnv,
  opts: AppServerOptions,
  timeoutMs: number,
): Promise<{ authUrl: string; done: Promise<void> }> {
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  const authUrl = await withCodexAppServer(
    env,
    { ...opts },
    async (rpc) => {
      rpc.onNotification((method) => {
        if (method === 'account/login/completed') {
          setTimeout(() => {
            rpc.close();
            finish();
          }, 500).unref();
        }
      });
      const res = await rpc.request('account/login/start', { type: 'chatgpt' });
      const url = str(res.authUrl);
      if (!url) throw new Error('codex did not return a login URL');
      setTimeout(() => {
        rpc.close();
        finish();
      }, timeoutMs).unref();
      return url;
    },
    true,
  );
  return { authUrl, done };
}
