import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

async function git(workDir: string, args: string[], input?: string): Promise<string> {
  const child = execFileAsync('git', ['-C', workDir, ...args], { maxBuffer: MAX_BUFFER });
  if (input !== undefined) child.child.stdin?.end(input);
  return (await child).stdout;
}

/**
 * Hash of what a run can change in a git working tree: HEAD, tracked changes and the content of
 * untracked files. Undefined when workDir is not a git work tree or git fails, so callers can tell
 * "unchanged" from "unknown".
 */
export async function treeFingerprint(workDir: string): Promise<string | undefined> {
  try {
    const head = await git(workDir, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => undefined);
    // Without a first commit there is no HEAD to diff against: staged and unstaged changes are separate.
    const diff =
      head === undefined
        ? `${await git(workDir, ['diff', '--no-ext-diff', '--cached'])}\0${await git(workDir, ['diff', '--no-ext-diff'])}`
        : await git(workDir, ['diff', '--no-ext-diff', 'HEAD']);
    const untracked = await git(workDir, ['ls-files', '--others', '--exclude-standard', '-z']);
    const paths = untracked.split('\0').filter(Boolean);
    const hashes = paths.length
      ? await git(workDir, ['hash-object', '--stdin-paths'], `${paths.join('\n')}\n`)
      : '';
    return createHash('sha256')
      .update(head ?? 'none')
      .update('\0')
      .update(diff)
      .update('\0')
      .update(paths.join('\0'))
      .update('\0')
      .update(hashes)
      .digest('hex');
  } catch {
    return undefined;
  }
}
