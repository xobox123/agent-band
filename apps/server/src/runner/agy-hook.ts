import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { object } from './parsers.ts';

const AGY_HOOK_NAME = 'agent-band-policy';
const AGY_EXCLUDE_LINE = '.agents/hooks.json';
const agyRuns = new Set<string>();

function git(workDir: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', ['-C', workDir, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout.trim() };
}

/** The script path inside a registered hook command, or undefined when the entry is not ours. */
function hookScriptOf(entry: unknown): string | undefined {
  try {
    const first = object(entry).PreToolUse as unknown[];
    const command = (object(first[0]).hooks as unknown[])[0];
    return /^node "([^"]+)"/.exec(String(object(command).command))?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Registers the policy hook in the workspace .agents/hooks.json (agy has no setting for another
 * path and loads this file headless, without a trust prompt) and returns the function that puts the
 * previous state back. The file exists only for the run: read-only, excluded from git, with its
 * sha256 stored in stateFile (outside the workspace) so the hook can detect tampering. A stale entry
 * of a crashed run (its script is gone) is cleaned up first. The user's global hooks are never touched.
 */
export function registerAgyHook(workDir: string, hookCommand: string, stateFile: string): () => void {
  const dir = join(workDir, '.agents');
  const file = join(dir, 'hooks.json');
  const key = resolve(workDir);
  if (agyRuns.has(key)) throw new Error('another Antigravity run is active in this workspace');
  const inGit = git(workDir, ['rev-parse', '--git-dir']).ok;
  if (inGit && git(workDir, ['ls-files', '--error-unmatch', '--', '.agents/hooks.json']).ok) {
    throw new Error('the repository tracks .agents/hooks.json; Antigravity runs need it free');
  }
  const exclude = inGit
    ? git(workDir, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']).out
    : '';
  const dirExisted = existsSync(dir);
  let hooks: Record<string, unknown> = {};
  let unreadable: string | undefined;
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    try {
      hooks = object(JSON.parse(text));
    } catch {
      unreadable = text;
    }
  }
  const stale = hooks[AGY_HOOK_NAME];
  if (stale !== undefined) {
    const script = hookScriptOf(stale);
    if (script !== undefined && existsSync(script)) {
      throw new Error('another Antigravity run is active in this workspace');
    }
    hooks = Object.fromEntries(Object.entries(hooks).filter(([name]) => name !== AGY_HOOK_NAME));
  }
  const baseline =
    unreadable ?? (Object.keys(hooks).length ? `${JSON.stringify(hooks, null, 2)}\n` : undefined);
  const command = `${hookCommand} ${JSON.stringify(file)} ${JSON.stringify(stateFile)}`;
  hooks[AGY_HOOK_NAME] = {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }],
  };
  const content = JSON.stringify(hooks, null, 2);
  agyRuns.add(key);
  mkdirSync(dir, { recursive: true });
  rmSync(file, { force: true });
  writeFileSync(file, content, { mode: 0o444 });
  writeFileSync(stateFile, createHash('sha256').update(content).digest('hex'));
  let excludeBefore: string | undefined;
  if (exclude) {
    mkdirSync(dirname(exclude), { recursive: true });
    excludeBefore = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    const sep = excludeBefore === '' || excludeBefore.endsWith('\n') ? '' : '\n';
    appendFileSync(exclude, `${sep}${AGY_EXCLUDE_LINE}\n`);
  }
  return () => {
    agyRuns.delete(key);
    rmSync(file, { force: true });
    if (baseline !== undefined) writeFileSync(file, baseline);
    if (!dirExisted) rmSync(dir, { recursive: true, force: true });
    rmSync(stateFile, { force: true });
    if (exclude && excludeBefore !== undefined) writeFileSync(exclude, excludeBefore);
  };
}
