import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agyHookScript } from '../infra/agy-hook-script.ts';

/** Writes the PreToolUse hook script of one Antigravity run and returns the hook command. */
export async function writeAgyRunConfig(opts: { dir: string; runId: string; port: number }): Promise<string> {
  const dir = join(opts.dir, 'antigravity');
  await mkdir(dir, { recursive: true });
  const script = join(dir, 'authorize-tool.mjs');
  await writeFile(script, agyHookScript({ port: opts.port, runId: opts.runId }));
  return `node ${JSON.stringify(script)}`;
}
