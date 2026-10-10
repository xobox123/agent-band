import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { cliCommand, missingCliMessage, withCliPath, type CliName } from './cli-locator.ts';
import { parseClaudeUsageText, type ClaudeUsage } from './claude-usage.ts';
import { readCodexNative, startCodexNativeLogin, type CodexUsageInfo } from './codex-app-server.ts';
import type { ModelOption } from '@agent-band/contracts';
import { parseAgyModels } from './models.ts';
import { object } from './parsers.ts';

export type CliProvider = 'claude' | 'openai' | 'gemini' | 'antigravity';
/** Replaces the real CLI; tests point this at a fake script. */
export type CliBins = Partial<Record<CliProvider, { cmd: string; args?: string[] }>>;

export interface LimitWindowInfo {
  window: '5h' | 'weekly';
  usedPercent: number;
  resetsAt: string | null;
}

export interface ProbeIdentity {
  email?: string;
  orgId?: string;
  orgName?: string;
  plan?: string;
  authMethod?: string;
}
export interface ProbeResult {
  loggedIn: boolean;
  identity: ProbeIdentity;
  checkedAt: string;
  error?: string;
  /** Extra hint for the user, for example that an API key is only verified on first use. */
  note?: string;
  loginCommand: string | null;
}
export interface ProbeOptions {
  bins?: CliBins;
  timeoutMs?: number;
}

const PROBE_TIMEOUT_MS = 15_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

const ENV_KEY = { claude: 'CLAUDE_CONFIG_DIR', openai: 'CODEX_HOME', gemini: 'GEMINI_CLI_HOME' } as const;
const DEFAULT_DIR = {
  claude: '.claude',
  openai: '.codex',
  gemini: '.gemini',
  antigravity: '.gemini',
} as const;

export function defaultConfigDir(provider: CliProvider): string {
  return join(homedir(), DEFAULT_DIR[provider]);
}
export function isDefaultConfigDir(provider: CliProvider, dir: string | null): boolean {
  // agy has no config-dir variable: its login lives in the OS keyring, so there is only the default account.
  if (dir === null || provider === 'antigravity') return true;
  const resolved = resolve(dir);
  // GEMINI_CLI_HOME names the home root that contains `.gemini`, so the real home is the default too.
  return resolved === defaultConfigDir(provider) || (provider === 'gemini' && resolved === homedir());
}
/** Directory that holds a Gemini account's `.gemini` folder. */
export function geminiHomeRoot(dir: string | null): string {
  return isDefaultConfigDir('gemini', dir) || dir === null ? homedir() : resolve(dir);
}
/** The default dir is left implicit: setting the variable changes where the CLI looks up its login. */
export function cliEnv(provider: CliProvider, dir: string | null): NodeJS.ProcessEnv {
  const env =
    provider === 'antigravity' || isDefaultConfigDir(provider, dir) || dir === null
      ? { ...process.env }
      : { ...process.env, [ENV_KEY[provider]]: dir };
  return withCliPath(cliNameOf(provider), env);
}
export const cliNameOf = (provider: CliProvider): CliName =>
  provider === 'openai' ? 'codex' : provider === 'antigravity' ? 'agy' : provider;
const shellQuote = (s: string): string => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function loginCommand(provider: CliProvider, dir: string | null): string {
  // Gemini and agy have no login subcommand: their interactive UI offers the sign-in on first start.
  const base = {
    claude: 'claude auth login',
    openai: 'codex login',
    gemini: 'gemini',
    antigravity: 'agy',
  }[provider];
  if (provider === 'antigravity' || isDefaultConfigDir(provider, dir) || dir === null) return base;
  return `${ENV_KEY[provider]}=${shellQuote(dir)} ${base}`;
}

interface CliOutput {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  missing: boolean;
  error?: string;
}

function bin(provider: CliProvider, bins: CliBins | undefined, args: string[]) {
  const b = bins?.[provider];
  return { cmd: b?.cmd ?? cliCommand(cliNameOf(provider)), args: [...(b?.args ?? []), ...args] };
}

function runCli(
  spec: { cmd: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string; input?: string },
  timeoutMs: number,
  onLine?: (line: string) => void,
): Promise<CliOutput> {
  return new Promise((resolveOutput) => {
    const out: CliOutput = { stdout: '', stderr: '', code: null, timedOut: false, missing: false };
    const child = spawn(spec.cmd, spec.args, {
      env: spec.env,
      cwd: spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(spec.input);
    const kill = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      out.timedOut = true;
      kill();
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out.stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out.stderr += d.toString()));
    if (onLine) createInterface({ input: child.stdout }).on('line', onLine);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOutput(out);
    };
    child.on('error', (err: NodeJS.ErrnoException) => {
      out.missing = err.code === 'ENOENT';
      out.error = err.message;
      finish();
    });
    child.on('close', (code) => {
      out.code = code;
      finish();
    });
  });
}

function parseClaudeStatus(text: string): Pick<ProbeResult, 'loggedIn' | 'identity'> | null {
  let json: Record<string, unknown>;
  try {
    json = object(JSON.parse(text));
  } catch {
    return null;
  }
  if (typeof json.loggedIn !== 'boolean') return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const email = str(json.email),
    orgId = str(json.orgId),
    orgName = str(json.orgName),
    plan = str(json.subscriptionType),
    authMethod = str(json.authMethod);
  return {
    loggedIn: json.loggedIn,
    identity: {
      ...(email && { email }),
      ...(orgId && { orgId }),
      ...(orgName && { orgName }),
      ...(plan && { plan }),
      ...(authMethod && authMethod !== 'none' && { authMethod }),
    },
  };
}

/** Reads the login state from the provider CLI without spending tokens. */
export async function probeAccount(
  account: { provider: CliProvider; configDir: string | null },
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const { provider, configDir } = account;
  const command = loginCommand(provider, configDir);
  const checkedAt = new Date().toISOString();
  const fail = (error: string): ProbeResult => ({
    loggedIn: false,
    identity: {},
    checkedAt,
    error,
    loginCommand: command,
  });
  const name = cliNameOf(provider);
  if (provider === 'gemini') return probeGemini(configDir, opts, checkedAt, command);
  if (provider === 'antigravity') return probeAgy(opts, checkedAt, command);
  if (provider === 'openai') {
    try {
      const { account } = await readCodexNative(cliEnv(provider, configDir), opts, { limits: false });
      return {
        loggedIn: account.loggedIn,
        identity: {
          ...(account.email && { email: account.email }),
          ...(account.plan && { plan: account.plan }),
          ...(account.authType && { authMethod: account.authType }),
        },
        checkedAt,
        loginCommand: account.loggedIn ? null : command,
      };
    } catch (err) {
      // app-server unavailable (older Codex): fall back to the status command.
      const legacy = await legacyCodexStatus(configDir, opts, checkedAt, command);
      return legacy.error && legacy.error.startsWith('unexpected')
        ? fail(err instanceof Error ? err.message : String(err))
        : legacy;
    }
  }
  const { cmd, args } = bin(provider, opts.bins, ['auth', 'status']);
  const res = await runCli(
    { cmd, args, env: cliEnv(provider, configDir) },
    opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  if (res.missing) return fail(missingCliMessage(cliNameOf(provider)));
  if (res.timedOut)
    return fail(`${name} did not answer within ${(opts.timeoutMs ?? PROBE_TIMEOUT_MS) / 1000}s`);
  if (res.error) return fail(res.error);
  const parsed = parseClaudeStatus(res.stdout);
  if (!parsed) return fail(`unexpected output from ${name} auth status`);
  return { ...parsed, checkedAt, loginCommand: parsed.loggedIn ? null : command };
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Gemini CLI 0.6x has no auth or status subcommand, and /stats only works inside its interactive UI.
 * So this checks that the CLI starts (`--version`, no model call) and that the Google login was stored:
 * the credentials file is only stat'ed, never read. Expired or revoked logins are not detected here;
 * the first run reports them. The cached email comes from the non-secret google_accounts.json.
 */
async function probeGemini(
  configDir: string | null,
  opts: ProbeOptions,
  checkedAt: string,
  command: string,
): Promise<ProbeResult> {
  const fail = (error: string): ProbeResult => ({
    loggedIn: false,
    identity: {},
    checkedAt,
    error,
    loginCommand: command,
  });
  const { cmd, args } = bin('gemini', opts.bins, ['--version']);
  const res = await runCli(
    { cmd, args, env: cliEnv('gemini', configDir) },
    opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  if (res.missing) return fail(missingCliMessage('gemini'));
  if (res.timedOut) return fail('gemini did not answer in time');
  if (res.error) return fail(res.error);
  const home = join(geminiHomeRoot(configDir), '.gemini');
  if (!(await exists(join(home, 'oauth_creds.json')))) {
    return { loggedIn: false, identity: {}, checkedAt, loginCommand: command };
  }
  let email: string | undefined;
  try {
    const active = object(JSON.parse(await readFile(join(home, 'google_accounts.json'), 'utf8'))).active;
    if (typeof active === 'string' && active) email = active;
  } catch {
    // the account list is optional
  }
  return {
    loggedIn: true,
    identity: { authMethod: 'google-oauth', ...(email && { email }) },
    checkedAt,
    note: 'Gemini has no login status command: this confirms a stored Google login, which is verified on the first run.',
    loginCommand: null,
  };
}

/** The `agy -p "/usage"` envelope: answered locally, no model call, no quota spent. */
interface AgyUsageEnvelope {
  ok: boolean;
  error?: string;
  groups: { name: string; buckets: { window: string; remaining: number; resetsAt: string | null }[] }[];
}

function parseAgyUsage(text: string): AgyUsageEnvelope | null {
  let json: Record<string, unknown>;
  try {
    json = object(JSON.parse(text));
  } catch {
    return null;
  }
  if (typeof json.status !== 'string') return null;
  const data = object(object(json.command).data);
  const groups = (Array.isArray(data.groups) ? data.groups : []).map((g) => {
    const group = object(g);
    return {
      name: typeof group.name === 'string' ? group.name : 'models',
      buckets: (Array.isArray(group.buckets) ? group.buckets : []).flatMap((b) => {
        const bucket = object(b);
        return typeof bucket.window === 'string' && typeof bucket.remaining_fraction === 'number'
          ? [
              {
                window: bucket.window,
                remaining: bucket.remaining_fraction,
                resetsAt: typeof bucket.reset_time === 'string' ? bucket.reset_time : null,
              },
            ]
          : [];
      }),
    };
  });
  const error = typeof json.error === 'string' && json.error ? json.error : undefined;
  return { ok: json.status === 'SUCCESS' && groups.length > 0, ...(error && { error }), groups };
}

async function runAgyUsage(opts: ProbeOptions): Promise<{ usage: AgyUsageEnvelope } | { error: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ab-agy-'));
  try {
    const { cmd, args } = bin('antigravity', opts.bins, ['-p', '/usage', '--output-format', 'json']);
    const res = await runCli(
      { cmd, args, env: cliEnv('antigravity', null), cwd: dir },
      opts.timeoutMs ?? PROBE_TIMEOUT_MS,
    );
    if (res.missing) return { error: missingCliMessage('agy') };
    if (res.timedOut) return { error: 'agy did not answer in time' };
    const usage = parseAgyUsage(res.stdout);
    if (!usage)
      return { error: res.error ?? (res.stderr.trim().split('\n')[0] || 'unexpected output from agy') };
    return { usage };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * agy has no auth or whoami command, but `-p "/usage"` is a free local metadata call that needs the
 * login (it reads the account's quota), so a readable quota means logged in. The email and plan are
 * only shown in the interactive banner and stay unknown here.
 */
async function probeAgy(opts: ProbeOptions, checkedAt: string, command: string): Promise<ProbeResult> {
  const res = await runAgyUsage(opts);
  if ('error' in res)
    return { loggedIn: false, identity: {}, checkedAt, error: res.error, loginCommand: command };
  if (!res.usage.ok)
    return {
      loggedIn: false,
      identity: {},
      checkedAt,
      error: res.usage.error ?? 'agy could not read the account quota: sign in first',
      loginCommand: command,
    };
  return {
    loggedIn: true,
    identity: { authMethod: 'google-oauth' },
    checkedAt,
    note: 'agy does not report the account email or plan headlessly.',
    loginCommand: null,
  };
}

/** The models the logged-in account may use, from `agy models` (needs no model call). */
export async function listAgyModels(opts: ProbeOptions = {}): Promise<ModelOption[]> {
  const { cmd, args } = bin('antigravity', opts.bins, ['models']);
  const res = await runCli(
    { cmd, args, env: cliEnv('antigravity', null) },
    opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  if (res.missing) throw new Error(missingCliMessage('agy'));
  if (res.timedOut) throw new Error('agy models did not answer in time');
  const items = parseAgyModels(res.stdout);
  if (items.length <= 1) throw new Error('agy models returned no models: sign in first');
  return items;
}

/** Quota from `agy -p "/usage"`: per window the most used group wins, every group is listed per model. */
export async function readAgyUsage(opts: ProbeOptions = {}): Promise<LimitReading> {
  const res = await runAgyUsage(opts);
  if ('error' in res) throw new Error(res.error);
  if (!res.usage.ok) throw new Error(res.usage.error ?? 'agy returned no quota: sign in first');
  const used = (remaining: number) => Math.round((1 - remaining) * 1000) / 10;
  const windows: LimitWindowInfo[] = [];
  const perModel: LimitReading['perModel'] = [];
  for (const group of res.usage.groups) {
    for (const b of group.buckets) {
      if (b.window !== '5h' && b.window !== 'weekly') continue;
      const next = { window: b.window, usedPercent: used(b.remaining), resetsAt: b.resetsAt } as const;
      const at = windows.findIndex((w) => w.window === b.window);
      const current = windows[at];
      if (!current) windows.push(next);
      else if (next.usedPercent > current.usedPercent) windows[at] = next;
      perModel.push({
        label: `${group.name} (${b.window})`,
        usedPercent: next.usedPercent,
        resetsAt: b.resetsAt,
      });
    }
  }
  return { windows, perModel };
}

async function legacyCodexStatus(
  configDir: string | null,
  opts: ProbeOptions,
  checkedAt: string,
  command: string,
): Promise<ProbeResult> {
  const { cmd, args } = bin('openai', opts.bins, ['login', 'status']);
  const res = await runCli(
    { cmd, args, env: cliEnv('openai', configDir) },
    opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  const fail = (error: string): ProbeResult => ({
    loggedIn: false,
    identity: {},
    checkedAt,
    error,
    loginCommand: command,
  });
  if (res.missing) return fail(missingCliMessage('codex'));
  if (res.timedOut) return fail('codex did not answer in time');
  const text = `${res.stdout}\n${res.stderr}`;
  const loggedIn = res.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
  if (!loggedIn && !/not logged in/i.test(text)) return fail('unexpected output from codex login status');
  const method = /logged in using (.+)/i.exec(text)?.[1]?.trim();
  return {
    loggedIn,
    identity: loggedIn && method ? { authMethod: method } : {},
    checkedAt,
    loginCommand: loggedIn ? null : command,
  };
}

export interface LoginHandle {
  started: boolean;
  authUrl?: string;
  command: string;
  error?: string;
  /** Resolves when the login process exits or the timeout kills it; never rejects. */
  done: Promise<void>;
}

/** Starts the provider's official interactive login; agent-band never sees credentials. */
export async function startLogin(
  account: { provider: CliProvider; configDir: string | null; mode?: 'console' },
  opts: ProbeOptions & { openUrl?: (url: string) => void } = {},
): Promise<LoginHandle> {
  const { provider, configDir } = account;
  if (provider === 'gemini' || provider === 'antigravity') {
    // Sign-in happens inside the CLI's interactive UI, which cannot run headless: hand over the command.
    return { started: false, command: loginCommand(provider, configDir), done: Promise.resolve() };
  }
  if (provider === 'openai') {
    try {
      const { authUrl, done } = await startCodexNativeLogin(
        cliEnv(provider, configDir),
        opts,
        opts.timeoutMs ?? LOGIN_TIMEOUT_MS,
      );
      (opts.openUrl ?? openInBrowser)(authUrl);
      return { started: true, command: loginCommand(provider, configDir), authUrl, done };
    } catch {
      // fall through to the plain `codex login` command
    }
  }
  return spawnLogin(account, opts);
}

function openInBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true })
      .on('error', () => undefined)
      .unref();
  } catch {
    // the URL is also returned to the caller
  }
}

function spawnLogin(
  account: { provider: CliProvider; configDir: string | null; mode?: 'console' },
  opts: ProbeOptions,
): Promise<LoginHandle> {
  const { provider, configDir } = account;
  const command = loginCommand(provider, configDir);
  const { cmd, args } = bin(
    provider,
    opts.bins,
    provider === 'claude'
      ? ['auth', 'login', ...(account.mode === 'console' ? ['--console'] : [])]
      : ['login'],
  );
  return new Promise((resolveHandle) => {
    const child = spawn(cmd, args, {
      env: cliEnv(provider, configDir),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let authUrl: string | undefined;
    let announce: (() => void) | undefined;
    const scan = (chunk: Buffer) => {
      authUrl ??= /https:\/\/[^\s"'<>]+/.exec(chunk.toString())?.[0];
      if (authUrl) announce?.();
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    let finished!: () => void;
    const done = new Promise<void>((r) => (finished = r));
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }, opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finished();
      resolveHandle({
        started: false,
        command,
        error: err.code === 'ENOENT' ? missingCliMessage(cliNameOf(provider)) : err.message,
        done,
      });
    });
    child.on('spawn', () => {
      // Give the CLI a moment to print its login URL so the UI can show it as a fallback link.
      const settle = () => {
        clearTimeout(wait);
        resolveHandle({ started: true, command, ...(authUrl && { authUrl }), done });
      };
      const wait = setTimeout(settle, 3000);
      announce = settle;
    });
    child.on('close', () => {
      clearTimeout(timer);
      finished();
    });
    child.unref();
  });
}

export interface LimitReading {
  windows: LimitWindowInfo[];
  perModel: ClaudeUsage['perModel'];
  codex?: Omit<CodexUsageInfo, 'windows'>;
}

/** Free: `claude -p "/usage"` answers locally without a model call. */
export async function readClaudeUsage(
  account: { configDir: string | null },
  opts: ProbeOptions = {},
): Promise<LimitReading> {
  const dir = await mkdtemp(join(tmpdir(), 'ab-usage-'));
  try {
    const { cmd, args } = bin('claude', opts.bins, ['-p', '/usage', '--output-format', 'json']);
    const res = await runCli(
      { cmd, args, env: cliEnv('claude', account.configDir), cwd: dir },
      opts.timeoutMs ?? PROBE_TIMEOUT_MS,
    );
    if (res.missing) throw new Error(missingCliMessage('claude'));
    if (res.timedOut) throw new Error('claude /usage did not answer in time');
    let text: string;
    try {
      const result = object(JSON.parse(res.stdout)).result;
      text = typeof result === 'string' ? result : '';
    } catch {
      throw new Error('unexpected output from claude /usage');
    }
    const usage = parseClaudeUsageText(text);
    if (usage.windows.length === 0) throw new Error('claude /usage returned no limit windows');
    return usage;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Limits, credits and token history from Codex's own app-server. */
export async function readCodexUsage(
  account: { configDir: string | null },
  opts: ProbeOptions = {},
): Promise<LimitReading> {
  const { account: info, usage } = await readCodexNative(cliEnv('openai', account.configDir), opts, {
    limits: true,
  });
  if (!info.loggedIn || !usage) throw new Error('not logged in to Codex');
  const { windows, ...rest } = usage;
  return { windows, perModel: [], codex: rest };
}

/** Stores an API key in the Codex home of an api account via Codex's own `login --with-api-key`. */
export async function setupCodexApiKey(
  configDir: string,
  apiKey: string,
  opts: ProbeOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const { cmd, args } = bin('openai', opts.bins, ['login', '--with-api-key']);
  const res = await runCli(
    { cmd, args, env: cliEnv('openai', configDir), input: `${apiKey}\n` },
    opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  if (res.missing) return { ok: false, error: missingCliMessage('codex') };
  if (res.timedOut) return { ok: false, error: 'codex did not answer in time' };
  return res.code === 0 ? { ok: true } : { ok: false, error: 'codex rejected the API key login' };
}

/** Checks an API-key account without a model call; the key is only ever passed through env or stdin. */
export async function probeApiKey(
  account: { provider: CliProvider; configDir: string; apiKey: string },
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();
  const fail = (error: string): ProbeResult => ({
    loggedIn: false,
    identity: {},
    checkedAt,
    error,
    loginCommand: null,
  });
  if (account.provider === 'antigravity')
    return fail('Antigravity accounts use the Google login, not an API key');
  if (account.provider === 'gemini') {
    if (account.apiKey.trim() === '') return fail('no API key stored');
    return {
      loggedIn: true,
      identity: { plan: 'API key', authMethod: 'gemini-api-key' },
      checkedAt,
      note: 'The key is passed through the environment and verified on the first run.',
      loginCommand: null,
    };
  }
  if (account.provider === 'claude') {
    const { cmd, args } = bin('claude', opts.bins, ['auth', 'status']);
    const res = await runCli(
      { cmd, args, env: { ...cliEnv('claude', account.configDir), ANTHROPIC_API_KEY: account.apiKey } },
      opts.timeoutMs ?? PROBE_TIMEOUT_MS,
    );
    if (res.missing) return fail(missingCliMessage('claude'));
    if (res.timedOut) return fail('claude did not answer in time');
    const parsed = parseClaudeStatus(res.stdout);
    if (!parsed) return fail('unexpected output from claude auth status');
    return {
      loggedIn: parsed.loggedIn,
      identity: { ...parsed.identity, plan: 'API key' },
      checkedAt,
      note: 'The key is verified on the first run.',
      loginCommand: null,
    };
  }
  const setup = await setupCodexApiKey(account.configDir, account.apiKey, opts);
  if (!setup.ok) return fail(setup.error ?? 'could not store the API key');
  try {
    const { account: info } = await readCodexNative(cliEnv('openai', account.configDir), opts, {
      limits: false,
    });
    return {
      loggedIn: info.loggedIn,
      identity: { plan: 'API key', ...(info.authType && { authMethod: info.authType }) },
      checkedAt,
      note: 'The key is verified on the first run.',
      loginCommand: null,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
