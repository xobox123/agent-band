import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { tmp } from '../../roles/worker.testkit.ts';
import { writeAgyRunConfig } from '../app/agy-config.ts';

const RUN = '11111111-1111-4111-8111-111111111111';
let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

/** The shape of a real PreToolUse payload captured from agy 1.3.1. */
const payload = (name: string, args: object) => ({
  conversationId: 'c1',
  modelName: 'gemini-3.8-flash-low',
  stepIdx: 2,
  toolCall: { name, args },
  workspacePaths: ['/w'],
});
const READ = payload('view_file', { AbsolutePath: '/w/a.txt', StartLine: 1, EndLine: 5 });

async function runHook(
  port: number,
  opts: {
    token?: string;
    stdin?: string | ((hooksFile: string) => object);
    tamper?: 'edit' | 'delete' | 'nostate';
  } = {},
) {
  const dir = await tmp();
  const { command, stateFile } = await writeAgyRunConfig({ dir, runId: RUN, port });
  const script = JSON.parse(command.replace(/^node /, '')) as string;
  const hooksFile = join(await tmp(), '.agents', 'hooks.json');
  mkdirSync(dirname(hooksFile));
  writeFileSync(hooksFile, '{"agent-band-policy":{}}');
  writeFileSync(stateFile, createHash('sha256').update(readFileSync(hooksFile)).digest('hex'));
  if (opts.tamper === 'edit') writeFileSync(hooksFile, '{}');
  if (opts.tamper === 'delete') rmSync(hooksFile);
  if (opts.tamper === 'nostate') rmSync(stateFile);
  const child = spawn(process.execPath, [script, hooksFile, stateFile], {
    env: { ...process.env, ...(opts.token === undefined ? {} : { AGENT_BAND_RUN_TOKEN: opts.token }) },
  });
  let out = '';
  child.stdout.on('data', (c: Buffer) => (out += c.toString()));
  const stdin = typeof opts.stdin === 'function' ? JSON.stringify(opts.stdin(hooksFile)) : opts.stdin;
  child.stdin.end(stdin ?? JSON.stringify(READ));
  const code = await new Promise<number | null>((r) => child.on('close', r));
  return { code, out, command, hooksFile };
}

const answer = (out: string) => JSON.parse(out) as { decision: string; reason?: string };

describe('generated Antigravity PreToolUse hook', () => {
  it('denies (fails closed) when the API is unreachable', async () => {
    const r = await runHook(await closedPort(), { token: 't' });
    expect(r.code).toBe(0);
    expect(answer(r.out).decision).toBe('deny');
    expect(answer(r.out).reason).toContain('agent-band');
  });

  it('denies without a token, on bad stdin and on non-200 or invalid answers', async () => {
    const port = await serve((_req, res) => {
      res.statusCode = 500;
      res.end('{}');
    });
    expect(answer((await runHook(port)).out).decision).toBe('deny');
    expect(answer((await runHook(port, { token: 't', stdin: 'not json' })).out).decision).toBe('deny');
    expect(answer((await runHook(port, { token: 't' })).out).decision).toBe('deny');
    expect(answer((await runHook(port, { token: 't', stdin: '{}' })).out).decision).toBe('deny');
    server?.close();
    const ok = await serve((_req, res) => {
      res.end(JSON.stringify({ nonsense: true }));
    });
    expect(answer((await runHook(ok, { token: 't' })).out).reason).toContain('invalid');
  });

  it('turns a server deny into a deny decision with the reason', async () => {
    const port = await serve((_req, res) => {
      res.end(JSON.stringify({ decision: 'deny', reason: 'path outside' }));
    });
    expect(answer((await runHook(port, { token: 't' })).out)).toEqual({
      decision: 'deny',
      reason: 'agent-band: path outside',
    });
  });

  it('allows with an explicit decision and posts the run token with Claude-equivalent names', async () => {
    let seen: { url?: string; token?: unknown; body?: unknown } = {};
    const port = await serve((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen = { url: req.url, token: req.headers['x-agent-band-run-token'], body: JSON.parse(body) };
        res.end(JSON.stringify({ decision: 'allow', reason: 'ok' }));
      });
    });
    const r = await runHook(port, { token: 'secret-token' });
    expect(r.code).toBe(0);
    expect(answer(r.out)).toEqual({ decision: 'allow' });
    expect(r.command).toMatch(/^node ".*\/antigravity\/authorize-tool\.mjs"$/);
    expect(seen.url).toBe(`/api/v1/runs/${RUN}/authorize-tool`);
    expect(seen.token).toBe('secret-token');
    expect(seen.body).toEqual({ runId: RUN, toolName: 'Read', toolInput: { file_path: '/w/a.txt' } });
  });

  it('maps shell, write, search and web calls to the names the policy knows', async () => {
    const bodies: { toolName: string; toolInput: Record<string, unknown> }[] = [];
    const port = await serve((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        bodies.push(JSON.parse(body) as (typeof bodies)[number]);
        res.end(JSON.stringify({ decision: 'allow' }));
      });
    });
    const call = (stdin: object) => runHook(port, { token: 't', stdin: JSON.stringify(stdin) });
    await call(payload('run_command', { CommandLine: 'ls -la', Cwd: '/w' }));
    await call(payload('write_to_file', { TargetFile: '/w/b', CodeContent: 'c', Overwrite: true }));
    await call(payload('replace_file_content', { TargetFile: '/w/c', StartLine: 1, EndLine: 2 }));
    await call(payload('read_url_content', { Url: 'https://example.com' }));
    await call(payload('search_web', { query: 'agy' }));
    await call(payload('grep_search', { Query: 'x', SearchPath: '/w/src' }));
    await call(payload('list_dir', { DirectoryPath: '/w/packages' }));
    expect(bodies.map((b) => b.toolName)).toEqual([
      'Bash',
      'Write',
      'Edit',
      'WebFetch',
      'WebSearch',
      'Grep',
      'Glob',
    ]);
    expect(bodies[0]?.toolInput).toEqual({ command: 'ls -la' });
    expect(bodies[1]?.toolInput).toEqual({ file_path: '/w/b' });
    expect(bodies[3]?.toolInput).toEqual({ url: 'https://example.com' });
    expect(bodies[5]?.toolInput).toEqual({ path: '/w/src' });
    expect(bodies[6]?.toolInput).toEqual({ path: '/w/packages' });
  });

  it('denies every call once the hook config was edited, deleted or lost its recorded hash', async () => {
    let asked = 0;
    const port = await serve((_req, res) => {
      asked++;
      res.end(JSON.stringify({ decision: 'allow' }));
    });
    for (const tamper of ['edit', 'delete', 'nostate'] as const) {
      const r = await runHook(port, { token: 't', tamper });
      expect(answer(r.out).decision).toBe('deny');
      expect(answer(r.out).reason).toMatch(/hook config/);
    }
    expect(asked).toBe(0);
  });

  it('denies writes, edits and shell commands that touch the .agents directory', async () => {
    let asked = 0;
    const port = await serve((_req, res) => {
      asked++;
      res.end(JSON.stringify({ decision: 'allow' }));
    });
    const denied: ((hooksFile: string) => object)[] = [
      (f) => payload('write_to_file', { TargetFile: f }),
      (f) => payload('replace_file_content', { TargetFile: join(dirname(f), 'rules.json') }),
      (f) => payload('write_to_file', { TargetFile: join(dirname(dirname(f)), 'src', '..', '.agents', 'x') }),
      () => payload('run_command', { CommandLine: 'rm .agents/hooks.json' }),
    ];
    for (const build of denied) {
      const r = await runHook(port, { token: 't', stdin: build });
      expect(answer(r.out).reason).toContain('.agents');
    }
    expect(asked).toBe(0);
    const ok = await runHook(port, {
      token: 't',
      stdin: (f) => payload('write_to_file', { TargetFile: join(dirname(dirname(f)), 'a.txt') }),
    });
    expect(answer(ok.out).decision).toBe('allow');
  });

  it('passes the glob pattern of find_by_name to the policy', async () => {
    let body: { toolName?: string; toolInput?: unknown } = {};
    const port = await serve((req, res) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString()));
      req.on('end', () => {
        body = JSON.parse(b) as typeof body;
        res.end(JSON.stringify({ decision: 'allow' }));
      });
    });
    await runHook(port, {
      token: 't',
      stdin: JSON.stringify(payload('find_by_name', { SearchDirectory: '/w', Pattern: '/etc/*' })),
    });
    expect(body.toolInput).toEqual({ path: '/w', pattern: '/etc/*' });
  });

  it('denies without asking the server what it cannot judge: unknown tools, MCP, subagents, no path', async () => {
    const port = await closedPort();
    for (const stdin of [
      payload('call_mcp_tool', { ServerName: 's', ToolName: 't' }),
      payload('invoke_subagent', {}),
      payload('sed_file', { TargetFile: '/w/x' }),
      payload('view_file', {}),
      payload('mystery_tool', { AbsolutePath: '/w/x' }),
    ]) {
      const r = await runHook(port, { token: 't', stdin: JSON.stringify(stdin) });
      expect(answer(r.out).reason).toMatch(/not supported|cannot be checked/);
    }
  });
});
