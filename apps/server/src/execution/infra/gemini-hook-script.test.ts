import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { tmp } from '../../roles/worker.testkit.ts';
import { geminiSettings, writeGeminiRunConfig } from '../app/gemini-config.ts';

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

const READ = { tool_name: 'read_file', tool_input: { file_path: '/w/a.txt' } };

async function runHook(port: number, opts: { token?: string; stdin?: string } = {}) {
  const dir = await tmp();
  const settings = await writeGeminiRunConfig({ dir, runId: RUN, port });
  const script = (
    JSON.parse(readFileSync(settings, 'utf8')) as {
      hooks: { BeforeTool: { hooks: { command: string }[] }[] };
    }
  ).hooks.BeforeTool[0]?.hooks[0]?.command.replace(/^node /, '');
  const child = spawn(process.execPath, [JSON.parse(script ?? '""') as string], {
    env: { ...process.env, ...(opts.token === undefined ? {} : { AGENT_BAND_RUN_TOKEN: opts.token }) },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c: Buffer) => (out += c.toString()));
  child.stderr.on('data', (c: Buffer) => (err += c.toString()));
  child.stdin.end(opts.stdin ?? JSON.stringify(READ));
  const code = await new Promise<number | null>((r) => child.on('close', r));
  return { code, out, err };
}

const denial = (out: string) => JSON.parse(out) as { decision: string; reason: string };

describe('generated Gemini BeforeTool hook', () => {
  it('denies (fails closed) when the API is unreachable', async () => {
    const r = await runHook(await closedPort(), { token: 't' });
    expect(r.code).toBe(0);
    expect(denial(r.out)).toMatchObject({ decision: 'deny' });
    expect(denial(r.out).reason).toContain('agent-band');
  });

  it('denies without a token, on bad stdin and on non-200 or invalid answers', async () => {
    const port = await serve((_req, res) => {
      res.statusCode = 500;
      res.end('{}');
    });
    expect(denial((await runHook(port)).out).decision).toBe('deny');
    expect(denial((await runHook(port, { token: 't', stdin: 'not json' })).out).decision).toBe('deny');
    expect(denial((await runHook(port, { token: 't' })).out).decision).toBe('deny');
    expect(denial((await runHook(port, { token: 't', stdin: '{}' })).out).decision).toBe('deny');
    server?.close();
    const ok = await serve((_req, res) => {
      res.end(JSON.stringify({ nonsense: true }));
    });
    expect(denial((await runHook(ok, { token: 't' })).out).reason).toContain('invalid');
  });

  it('turns a server deny into a deny decision with the reason', async () => {
    const port = await serve((_req, res) => {
      res.end(JSON.stringify({ decision: 'deny', reason: 'path outside' }));
    });
    expect(denial((await runHook(port, { token: 't' })).out)).toEqual({
      decision: 'deny',
      reason: 'agent-band: path outside',
    });
  });

  it('prints nothing on allow and posts the run token with Claude-equivalent names', async () => {
    let seen: { url?: string; token?: unknown; body?: unknown } = {};
    const port = await serve((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen = { url: req.url, token: req.headers['x-agent-band-run-token'], body: JSON.parse(body) };
        res.end(JSON.stringify({ decision: 'allow', reason: 'ok' }));
      });
    });
    expect(await runHook(port, { token: 'secret-token' })).toMatchObject({ code: 0, out: '' });
    expect(seen.url).toBe(`/api/v1/runs/${RUN}/authorize-tool`);
    expect(seen.token).toBe('secret-token');
    expect(seen.body).toEqual({ runId: RUN, toolName: 'Read', toolInput: { file_path: '/w/a.txt' } });
  });

  it('maps shell, search and MCP calls to the names the policy knows', async () => {
    const bodies: { toolName: string; toolInput: Record<string, unknown> }[] = [];
    const port = await serve((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        bodies.push(JSON.parse(body) as (typeof bodies)[number]);
        res.end(JSON.stringify({ decision: 'allow', reason: 'ok' }));
      });
    });
    const call = (stdin: object) => runHook(port, { token: 't', stdin: JSON.stringify(stdin) });
    await call({ tool_name: 'run_shell_command', tool_input: { command: 'ls', description: 'x' } });
    await call({ tool_name: 'grep_search', tool_input: { pattern: 'x', dir_path: '/w/src' } });
    await call({ tool_name: 'write_file', tool_input: { absolute_path: '/w/b', content: 'c' } });
    await call({
      tool_name: 'mcp_agent_band_ask_human',
      tool_input: { q: 1 },
      mcp_context: { server_name: 'agent_band', tool_name: 'ask_human' },
    });
    await call({ tool_name: 'save_memory', tool_input: {} });
    expect(bodies.map((b) => b.toolName)).toEqual([
      'Bash',
      'Grep',
      'Write',
      'mcp__agent_band__ask_human',
      'save_memory',
    ]);
    expect(bodies[0]?.toolInput).toMatchObject({ command: 'ls' });
    expect(bodies[1]?.toolInput).toMatchObject({ path: '/w/src', pattern: 'x' });
    expect(bodies[2]?.toolInput).toMatchObject({ file_path: '/w/b' });
  });

  it('denies read_many_files without asking the server, because its paths cannot be checked', async () => {
    const r = await runHook(await closedPort(), {
      token: 't',
      stdin: JSON.stringify({ tool_name: 'read_many_files', tool_input: { paths: ['/etc/*'] } }),
    });
    expect(denial(r.out).reason).toContain('not supported');
  });
});

describe('per-run Gemini settings', () => {
  it('registers a BeforeTool hook for every tool and excludes denied tools natively', () => {
    const settings = geminiSettings({
      hookCommand: 'node "/r/hook.mjs"',
      deniedTools: ['Bash', 'WebFetch', 'Bash(rm:*)'],
    });
    expect(settings).toMatchObject({
      hooks: {
        BeforeTool: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'node "/r/hook.mjs"', timeout: 10000 }],
          },
        ],
      },
      tools: { exclude: ['run_shell_command', 'web_fetch', 'read_many_files'] },
    });
    expect(settings).not.toHaveProperty('mcpServers');
    expect(settings).not.toHaveProperty('security');
  });

  it('attaches the delegation server with the token as an env reference, never the literal token', async () => {
    const dir = await tmp();
    const path = await writeGeminiRunConfig({
      dir,
      runId: RUN,
      port: 1234,
      mcpUrl: 'http://127.0.0.1:1234/api/v1/mcp?runId=r',
      apiKey: true,
    });
    const text = readFileSync(path, 'utf8');
    const json = JSON.parse(text) as Record<string, Record<string, unknown>>;
    expect(json.mcpServers).toEqual({
      agent_band: {
        httpUrl: 'http://127.0.0.1:1234/api/v1/mcp?runId=r',
        headers: { Authorization: 'Bearer $AGENT_BAND_RUN_TOKEN' },
        timeout: 30000,
        trust: true,
      },
    });
    expect(json.security).toEqual({ auth: { selectedType: 'gemini-api-key' } });
    expect(path).toBe(`${dir}/gemini/settings.json`);
  });
});
