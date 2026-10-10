import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agyHookScript } from '../infra/agy-hook-script.ts';

/**
 * Writes the PreToolUse hook script of one Antigravity run (in the run dir, outside the workspace)
 * and returns the hook command plus the file where the adapter stores the hooks.json hash.
 */
export async function writeAgyRunConfig(opts: {
  dir: string;
  runId: string;
  port: number;
}): Promise<{ command: string; stateFile: string }> {
  const dir = join(opts.dir, 'antigravity');
  await mkdir(dir, { recursive: true });
  const script = join(dir, 'authorize-tool.mjs');
  await writeFile(script, agyHookScript({ port: opts.port, runId: opts.runId }));
  return { command: `node ${JSON.stringify(script)}`, stateFile: join(dir, 'hooks.sha256') };
}
