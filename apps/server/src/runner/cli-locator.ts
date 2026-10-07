import { spawn } from 'node:child_process';
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type CliName = 'claude' | 'codex' | 'gemini';
export type CliSource = 'env' | 'path' | 'shell' | 'known';

export interface CliDiagnostic {
  binary: string | null;
  version: string | null;
  source: CliSource | null;
  error?: string;
}

export interface LocatorOptions {
  /** Explicit absolute paths (AGENT_BAND_<NAME>_BIN); they win over every other source. */
  overrides?: Partial<Record<CliName, string>>;
  /** Environment used for the PATH lookup and passed to the login shell. */
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Login shell for `command -v`; defaults to $SHELL, then a platform default. */
  shell?: string;
  shellTimeoutMs?: number;
  versionTimeoutMs?: number;
  /** Replaces the well-known directory list; tests use this to stay off the real machine. */
  knownDirs?: string[];
}

export const CLI_NAMES: readonly CliName[] = ['claude', 'codex', 'gemini'];

const LABEL: Record<CliName, string> = {
  claude: 'Claude Code CLI',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

export const cliEnvVar = (name: CliName): string => `AGENT_BAND_${name.toUpperCase()}_BIN`;

export function missingCliMessage(name: CliName): string {
  return `${LABEL[name]} not found. Install it or set ${cliEnvVar(name)}`;
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function nvmBins(home: string, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  if (env.NVM_BIN) out.push(env.NVM_BIN);
  const root = join(home, '.nvm', 'versions', 'node');
  let versions: string[];
  try {
    versions = readdirSync(root);
  } catch {
    return out;
  }
  const num = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  versions.sort((a, b) => {
    const x = num(a),
      y = num(b);
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  });
  let preferred: string | undefined;
  try {
    const alias = readFileSync(join(home, '.nvm', 'alias', 'default'), 'utf8')
      .trim()
      .replace(/^v/, '');
    preferred = versions.find(
      (v) => v.replace(/^v/, '') === alias || v.replace(/^v/, '').startsWith(`${alias}.`),
    );
  } catch {
    // no default alias: newest installed version first
  }
  if (preferred) out.push(join(root, preferred, 'bin'));
  for (const v of versions) out.push(join(root, v, 'bin'));
  return out;
}

export function knownDirs(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    ...nvmBins(home, env),
  ];
}

interface Captured {
  stdout: string;
  code: number | null;
  timedOut: boolean;
}

function capture(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Captured> {
  return new Promise((resolve) => {
    const out: Captured = { stdout: '', code: null, timedOut: false };
    let child;
    try {
      child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    } catch {
      resolve(out);
      return;
    }
    const timer = setTimeout(() => {
      out.timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out.stdout += d.toString()));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(out);
    };
    child.on('error', finish);
    child.on('close', (code) => {
      out.code = code;
      finish();
    });
  });
}

export class CliLocator {
  private readonly cache = new Map<CliName, CliDiagnostic>();
  private readonly pending = new Map<CliName, Promise<CliDiagnostic>>();

  constructor(private readonly opts: LocatorOptions = {}) {}

  private get env(): NodeJS.ProcessEnv {
    return this.opts.env ?? process.env;
  }
  private get home(): string {
    return this.opts.home ?? homedir();
  }

  /** Resolved absolute path from the last detection, if any. */
  pathOf(name: CliName): string | undefined {
    return this.cache.get(name)?.binary ?? undefined;
  }
  cached(name: CliName): CliDiagnostic | undefined {
    return this.cache.get(name);
  }
  /** Detects once; later calls reuse the result until `detect` is called again. */
  ensure(name: CliName): Promise<CliDiagnostic> {
    const hit = this.cache.get(name);
    return hit ? Promise.resolve(hit) : this.detect(name);
  }
  /** Looks the binary up again (PATH, login shell, well-known dirs) and refreshes the cache. */
  detect(name: CliName): Promise<CliDiagnostic> {
    let run = this.pending.get(name);
    if (!run) {
      run = this.resolve(name)
        .then((d) => {
          this.cache.set(name, d);
          return d;
        })
        .finally(() => this.pending.delete(name));
      this.pending.set(name, run);
    }
    return run;
  }
  async detectAll(): Promise<Record<CliName, CliDiagnostic>> {
    const found = await Promise.all(CLI_NAMES.map((n) => this.detect(n)));
    return Object.fromEntries(CLI_NAMES.map((n, i) => [n, found[i]])) as Record<CliName, CliDiagnostic>;
  }

  /** PATH value that starts with the resolved binary's directory, so CLIs that spawn node etc. work. */
  pathWith(name: CliName, base: string | undefined): string | undefined {
    const bin = this.pathOf(name);
    if (!bin) return base;
    const dir = bin.slice(0, bin.lastIndexOf('/')) || '/';
    const rest = (base ?? '').split(delimiter).filter((p) => p && p !== dir);
    return [dir, ...rest].join(delimiter);
  }

  private async resolve(name: CliName): Promise<CliDiagnostic> {
    const override = this.opts.overrides?.[name];
    if (override) {
      if (!isExecutable(override))
        return {
          binary: null,
          version: null,
          source: null,
          error: `${cliEnvVar(name)} points to ${override}, which is not an executable file`,
        };
      return this.verified(name, override, 'env');
    }
    for (const dir of (this.env.PATH ?? '').split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return this.verified(name, candidate, 'path');
    }
    const fromShell = await this.fromShell(name);
    if (fromShell) return this.verified(name, fromShell, 'shell');
    for (const dir of this.opts.knownDirs ?? knownDirs(this.home, this.env)) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return this.verified(name, candidate, 'known');
    }
    return { binary: null, version: null, source: null, error: missingCliMessage(name) };
  }

  private async fromShell(name: CliName): Promise<string | undefined> {
    const shell =
      this.opts.shell ?? this.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
    if (!isExecutable(shell)) return undefined;
    const res = await capture(
      shell,
      ['-lc', `command -v ${name}`],
      { ...this.env, HOME: this.env.HOME ?? this.home },
      this.opts.shellTimeoutMs ?? 5000,
    );
    if (res.timedOut) return undefined;
    // Profiles may print banners; the answer is the last absolute path line.
    const line = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('/'))
      .pop();
    return line && isExecutable(line) ? line : undefined;
  }

  private async verified(name: CliName, binary: string, source: CliSource): Promise<CliDiagnostic> {
    const dir = binary.slice(0, binary.lastIndexOf('/')) || '/';
    const res = await capture(
      binary,
      ['--version'],
      { ...this.env, PATH: [dir, this.env.PATH ?? ''].filter(Boolean).join(delimiter) },
      this.opts.versionTimeoutMs ?? 5000,
    );
    const line = res.stdout.split('\n')[0]?.trim() ?? '';
    const version = /\d+\.\d+\.\d+[\w.+-]*/.exec(line)?.[0] ?? (line.slice(0, 60) || null);
    return { binary, version, source };
  }
}

let active = new CliLocator();
export const getCliLocator = (): CliLocator => active;
export const setCliLocator = (locator: CliLocator): void => {
  active = locator;
};

/** Command to spawn: the resolved absolute path when detection found one, otherwise the bare name. */
export const cliCommand = (name: CliName): string => active.pathOf(name) ?? name;
/** `env` with the resolved CLI's directory first in PATH. */
export function withCliPath(name: CliName, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = active.pathWith(name, env.PATH);
  return path === undefined ? env : { ...env, PATH: path };
}
