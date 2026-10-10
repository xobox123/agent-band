import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CHECK_OUTPUT_MAX_BYTES, parseNumstat, tailBytes, type FileStat } from '../domain/project.ts';

export interface GitIdentity {
  name: string;
  email: string;
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };

/** Runs git and returns the exit code instead of throwing on a non-zero exit. */
export function git(
  cwd: string,
  args: string[],
  opts: { env?: Record<string, string>; maxBuffer?: number } = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: { ...process.env, ...GIT_ENV, ...opts.env },
        maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout, stderr: err && typeof err.code !== 'number' ? err.message : stderr });
      },
    );
  });
}

async function must(cwd: string, args: string[], opts?: Parameters<typeof git>[2]): Promise<string> {
  const r = await git(cwd, args, opts);
  if (r.code !== 0) throw new Error(`git ${args[0] ?? ''} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

const identityEnv = (id: GitIdentity): Record<string, string> => ({
  GIT_AUTHOR_NAME: id.name,
  GIT_AUTHOR_EMAIL: id.email,
  GIT_COMMITTER_NAME: id.name,
  GIT_COMMITTER_EMAIL: id.email,
});

export type RepoInspection =
  { valid: true; defaultBranch: string; root: string } | { valid: false; reason: string };

/** Checks that the path is the root of a git repository with at least one commit. */
export async function inspectRepo(path: string): Promise<RepoInspection> {
  if (!existsSync(path)) return { valid: false, reason: 'path does not exist' };
  const top = await git(path, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { valid: false, reason: 'not a git repository' };
  const root = top.stdout.trim();
  if (realpathSync(root) !== realpathSync(path))
    return { valid: false, reason: `not the repository root (root is ${root})` };
  if ((await git(path, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code !== 0)
    return { valid: false, reason: 'the repository has no commits' };
  return { valid: true, defaultBranch: await detectDefaultBranch(path), root };
}

async function detectDefaultBranch(repo: string): Promise<string> {
  const remote = await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const fromRemote = remote.stdout.trim().replace(/^origin\//, '');
  if (remote.code === 0 && fromRemote && (await branchExists(repo, fromRemote))) return fromRemote;
  for (const name of ['main', 'master']) if (await branchExists(repo, name)) return name;
  const head = await git(repo, ['symbolic-ref', '--short', 'HEAD']);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  throw new Error('could not detect the default branch');
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0;
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  const r = await git(cwd, ['symbolic-ref', '--short', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

export async function revParse(cwd: string, ref: string): Promise<string> {
  return (await must(cwd, ['rev-parse', '--verify', ref])).trim();
}

export async function isClean(cwd: string): Promise<boolean> {
  return (await must(cwd, ['status', '--porcelain'])).trim() === '';
}

/** Creates the task worktree on a new branch; an existing worktree of that branch is reused. */
export async function ensureWorktree(opts: {
  repo: string;
  path: string;
  branch: string;
  base: string;
}): Promise<void> {
  const { repo, path, branch, base } = opts;
  if (existsSync(`${path}/.git`) && (await currentBranch(path)) === branch) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await git(repo, ['worktree', 'prune']);
  const exists = await branchExists(repo, branch);
  await must(
    repo,
    exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', path, '-b', branch, base],
  );
}

export async function removeWorktree(repo: string, path: string, branch: string | null): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', path]);
  await rm(path, { recursive: true, force: true });
  await git(repo, ['worktree', 'prune']);
  if (branch) await git(repo, ['branch', '-D', branch]);
}

export interface CheckResult {
  command: string;
  exitCode: number;
  durationMs: number;
  output: string;
}

/** Runs a shell command in the worktree; a timeout kills its process group and reports exit code 124. */
export function runCheck(cwd: string, command: string, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('sh', ['-c', command], {
      cwd,
      detached: true,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const add = (chunk: Buffer) => {
      output = tailBytes(output + chunk.toString('utf8'), CHECK_OUTPUT_MAX_BYTES * 2);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    const done = (code: number, extra = '') => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: timedOut ? 124 : code,
        durationMs: Date.now() - started,
        output: tailBytes(
          timedOut ? `${output}\ntimed out after ${Math.round(timeoutMs / 1000)}s` : output + extra,
          CHECK_OUTPUT_MAX_BYTES,
        ),
      });
    };
    child.on('error', (err) => {
      done(127, `\n${err.message}`);
    });
    child.on('close', (code) => {
      done(code ?? 1);
    });
  });
}

/** Commits every change in the worktree as the agent; returns false when nothing changed. */
export async function commitAll(cwd: string, message: string, identity: GitIdentity): Promise<boolean> {
  await must(cwd, ['add', '-A']);
  if ((await must(cwd, ['status', '--porcelain'])).trim() === '') return false;
  await must(cwd, ['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', message], {
    env: identityEnv(identity),
  });
  return true;
}

export async function mergeBase(cwd: string, a: string, b: string): Promise<string> {
  return (await must(cwd, ['merge-base', a, b])).trim();
}

export async function diffFiles(cwd: string, base: string, head: string): Promise<FileStat[]> {
  return parseNumstat(await must(cwd, ['diff', '--numstat', `${base}..${head}`]));
}

export async function commitsBetween(
  cwd: string,
  base: string,
  head: string,
): Promise<{ sha: string; subject: string }[]> {
  const out = await must(cwd, ['log', '--format=%H%x1f%s', '--reverse', `${base}..${head}`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\x1f');
      return { sha, subject };
    });
}

export async function unifiedDiff(
  cwd: string,
  base: string,
  head: string,
  maxBytes: number,
): Promise<{ diff: string; truncated: boolean }> {
  const out = await must(cwd, ['diff', '--no-color', '--no-ext-diff', `${base}..${head}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const buf = Buffer.from(out, 'utf8');
  if (buf.length <= maxBytes) return { diff: out, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return { diff: buf.subarray(0, end).toString('utf8'), truncated: true };
}

export type MergeResult = { ok: true; sha: string } | { ok: false; conflictFiles: string[]; message: string };

/** `git merge --no-ff` in `cwd`; on conflict the merge is aborted and the working tree is left clean. */
export async function mergeNoFf(opts: {
  cwd: string;
  branch: string;
  message: string;
  fallbackIdentity: GitIdentity;
}): Promise<MergeResult> {
  const { cwd, branch, message, fallbackIdentity } = opts;
  const configured = (await git(cwd, ['config', 'user.email'])).stdout.trim() !== '';
  const r = await git(
    cwd,
    ['-c', 'commit.gpgsign=false', 'merge', '--no-ff', '--no-verify', '-m', message, branch],
    configured ? {} : { env: identityEnv(fallbackIdentity) },
  );
  if (r.code === 0) return { ok: true, sha: await revParse(cwd, 'HEAD') };
  const unmerged = await git(cwd, ['diff', '--name-only', '--diff-filter=U']);
  const files = unmerged.stdout.split('\n').filter(Boolean);
  await git(cwd, ['merge', '--abort']);
  return { ok: false, conflictFiles: files, message: (r.stderr || r.stdout).trim() };
}
