import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { MCP_SERVER_NAME, RUN_ID_HEADER, RUN_TOKEN_HEADER } from '@agent-band/contracts';
import { HOOKS_JSON, hookScript } from '../infra/hook-script.ts';

export interface PluginSkill {
  skillId: string;
  name: string;
  files: Record<string, Uint8Array>;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeRelative(path: string): string {
  const n = posix.normalize(path);
  if (n.startsWith('/') || n === '..' || n.startsWith('../') || path.includes('\0') || n === '.') {
    throw new Error(`unsafe skill file path: ${path}`);
  }
  return n;
}

/** Writes a Claude plugin directory (manifest, skills, optional PreToolUse hook) for one run. */
export async function writeClaudePlugin(opts: {
  dir: string;
  runId: string;
  skills: PluginSkill[];
  hook?: { port: number };
}): Promise<void> {
  await mkdir(join(opts.dir, '.claude-plugin'), { recursive: true });
  await writeFile(
    join(opts.dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      { name: 'agent-band-run', version: '1.0.0', description: `agent-band run ${opts.runId}` },
      null,
      2,
    ),
  );
  const used = new Set<string>();
  for (const skill of opts.skills) {
    if (!SAFE_NAME.test(skill.name)) throw new Error(`unsafe skill name: ${skill.name}`);
    const dirName = used.has(skill.name) ? `${skill.name}-${skill.skillId.slice(0, 8)}` : skill.name;
    used.add(dirName);
    for (const [path, content] of Object.entries(skill.files)) {
      const target = join(opts.dir, 'skills', dirName, safeRelative(path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  if (opts.hook) {
    await mkdir(join(opts.dir, 'hooks'), { recursive: true });
    await writeFile(join(opts.dir, 'hooks', 'hooks.json'), JSON.stringify(HOOKS_JSON, null, 2));
    await writeFile(
      join(opts.dir, 'hooks', 'authorize-tool.mjs'),
      hookScript({ port: opts.hook.port, runId: opts.runId }),
    );
  }
}

/** URL of the delegation MCP server; the run id is bound to the URL and must match the token's run. */
export const mcpUrl = (port: number, runId: string): string =>
  `http://127.0.0.1:${port}/api/v1/mcp?runId=${encodeURIComponent(runId)}`;

/** Writes the Claude MCP config that attaches the delegation server to one leader run. */
export async function writeMcpConfig(opts: {
  path: string;
  port: number;
  runId: string;
  token: string;
}): Promise<void> {
  await mkdir(dirname(opts.path), { recursive: true });
  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: `http://127.0.0.1:${opts.port}/api/v1/mcp`,
        headers: { [RUN_ID_HEADER]: opts.runId, [RUN_TOKEN_HEADER]: opts.token },
      },
    },
  };
  await writeFile(opts.path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function removeRunDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
