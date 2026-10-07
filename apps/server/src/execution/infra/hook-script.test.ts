import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tmp } from '../../roles/worker.testkit.ts';
import { writeClaudePlugin } from '../app/plugin.ts';

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

async function runHook(port: number, opts: { token?: string; stdin?: string } = {}) {
  const dir = await tmp();
  await writeClaudePlugin({ dir, runId: RUN, skills: [], hook: { port } });
  const child = spawn(process.execPath, [join(dir, 'hooks/authorize-tool.mjs')], {
    env: { ...process.env, ...(opts.token === undefined ? {} : { AGENT_BAND_RUN_TOKEN: opts.token }) },
  });
  let out = '';
  child.stdout.on('data', (c: Buffer) => (out += c.toString()));
  child.stdin.end(opts.stdin ?? JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }));
  const code = await new Promise<number | null>((r) => child.on('close', r));
  return { code, out };
}

const denial = (out: string) =>
  (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput as Record<
    string,
    string | undefined
  >;

describe('generated PreToolUse hook', () => {
  it('writes the documented hooks.json next to the script', async () => {
    const dir = await tmp();
    await mkdir(join(dir, 'x'));
    await writeFile(join(dir, 'x', 'f'), '');
    await writeClaudePlugin({ dir, runId: RUN, skills: [], hook: { port: 1 } });
    const hooks = (await import('node:fs')).readFileSync(join(dir, 'hooks/hooks.json'), 'utf8');
    expect(JSON.parse(hooks)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/authorize-tool.mjs"',
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
  });

  it('denies (fails closed) when the API is unreachable', async () => {
    const r = await runHook(await closedPort(), { token: 't' });
    expect(r.code).toBe(0);
    expect(denial(r.out)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
  });

  it('denies without a token, on bad stdin and on non-200 or invalid answers', async () => {
    const port = await serve((_req, res) => {
      res.statusCode = 500;
      res.end('{}');
    });
    expect(denial((await runHook(port)).out).permissionDecision).toBe('deny');
    expect(denial((await runHook(port, { token: 't', stdin: 'not json' })).out).permissionDecision).toBe(
      'deny',
    );
    expect(denial((await runHook(port, { token: 't' })).out).permissionDecision).toBe('deny');
    server?.close();
    const ok = await serve((_req, res) => {
      res.end(JSON.stringify({ nonsense: true }));
    });
    expect(denial((await runHook(ok, { token: 't' })).out).permissionDecisionReason).toContain('invalid');
    expect(denial((await runHook(ok, { token: 't' })).out).permissionDecision).toBe('deny');
  });

  it('prints an explicit allow when the call is pre-approved', async () => {
    const port = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ decision: 'allow', reason: 'ok', preApproved: true }));
    });
    const r = await runHook(port, { token: 't' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'agent-band: pre-approved by policy',
      },
    });
  });

  it('posts the call with the run token and prints nothing on allow', async () => {
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
    expect(r).toEqual({ code: 0, out: '' });
    expect(seen.url).toBe(`/api/v1/runs/${RUN}/authorize-tool`);
    expect(seen.token).toBe('secret-token');
    expect(seen.body).toMatchObject({ runId: RUN, toolName: 'Read', toolInput: { file_path: '/x' } });
  });

  it('turns a server deny into a deny decision with the reason', async () => {
    const port = await serve((_req, res) => {
      res.end(JSON.stringify({ decision: 'deny', reason: 'path outside' }));
    });
    const r = await runHook(port, { token: 't' });
    expect(denial(r.out)).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: 'agent-band: path outside',
    });
  });
});
