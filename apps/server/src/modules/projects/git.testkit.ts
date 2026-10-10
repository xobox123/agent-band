import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

export function gitOut(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
}

/** A real repository on `main` with one commit; git runs only on temp directories. */
export function makeRepo(): { dir: string; base: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-band-git-')));
  const dir = join(base, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
  gitOut(dir, 'config', 'user.name', 'Owner');
  gitOut(dir, 'config', 'user.email', 'owner@example.com');
  gitOut(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  gitOut(dir, 'add', '-A');
  gitOut(dir, 'commit', '-q', '-m', 'initial');
  return { dir, base };
}
