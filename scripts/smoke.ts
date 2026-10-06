/**
 * Manual smoke test against a real CLI. It spends real tokens, so it is never run in CI or `npm test`.
 *
 *   npx tsx scripts/smoke.ts [--provider claude|openai] [--config-dir DIR]
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 5 * 60 * 1000;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
}

function fail(message: string): never {
  console.error(`smoke: FAIL: ${message}`);
  process.exit(1);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => {
        resolvePort(port);
      });
    });
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      provider: { type: 'string', default: 'claude' },
      'config-dir': { type: 'string' },
    },
  });
  const provider = values.provider;
  if (provider !== 'claude' && provider !== 'openai')
    fail(`--provider must be claude or openai, got "${provider}"`);
  const isClaude = provider === 'claude';
  const cli = isClaude ? 'claude' : 'codex';
  const configDir = resolve(values['config-dir'] ?? join(homedir(), isClaude ? '.claude' : '.codex'));

  if (spawnSync(cli, ['--version'], { stdio: 'ignore' }).status !== 0) {
    fail(`"${cli}" CLI not found in PATH`);
  }
  if (!existsSync(configDir)) {
    fail(`not logged in: config dir ${configDir} does not exist. Log in with the ${cli} CLI first.`);
  }

  const home = mkdtempSync(join(tmpdir(), 'agent-band-smoke-home-'));
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-band-smoke-work-')));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api/v1`;
  let server: ChildProcess | undefined;
  let serverLog = '';

  const cleanup = (): void => {
    server?.kill('SIGTERM');
    rmSync(home, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    server = spawn(join(repoRoot, 'node_modules/.bin/tsx'), ['apps/server/src/main.ts'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_BAND_HOME: home,
        AGENT_BAND_PORT: String(port),
        AGENT_BAND_ROLE: 'all',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (d: Buffer) => (serverLog += d.toString()));
    server.stderr?.on('data', (d: Buffer) => (serverLog += d.toString()));
    const proc = { exited: false };
    const hasExited = (): boolean => proc.exited;
    server.once('exit', () => {
      proc.exited = true;
    });

    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
      return (text ? JSON.parse(text) : null) as T;
    };

    const readyDeadline = Date.now() + 60_000;
    for (;;) {
      if (hasExited()) throw new Error(`server exited early:\n${serverLog}`);
      try {
        if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > readyDeadline) throw new Error(`server not ready in 60 s:\n${serverLog}`);
      await sleep(300);
    }

    const account = await api<{ id: string }>('POST', '/accounts', {
      name: `smoke-${provider}`,
      provider,
      type: 'cli',
      configDir,
    });
    const policy = await api<{ id: string }>('POST', '/policies', {
      name: 'smoke',
      description: 'Smoke test policy',
      rules: { workDirs: [workDir], maxMode: 'edit' },
    });
    const agent = await api<{ id: string }>('POST', '/agents', {
      slug: 'smoke',
      name: 'Smoke',
      accountId: account.id,
      policyId: policy.id,
      ...(isClaude ? { model: 'haiku' } : {}),
    });
    const task = await api<{ id: string; key: string }>('POST', '/tasks', {
      title: 'Smoke: create hello.txt',
      prompt:
        "Create a file hello.txt in the working directory containing exactly 'hello from agent-band', then reply DONE.",
      workDir,
      target: { agentId: agent.id },
      mode: 'edit',
    });
    console.log(`smoke: ${provider} task ${task.key} queued, waiting up to 5 min`);

    const deadline = Date.now() + TIMEOUT_MS;
    let status = 'queued';
    let taskError: string | null = null;
    while (Date.now() < deadline) {
      if (hasExited()) throw new Error(`server exited during the run:\n${serverLog}`);
      const t = await api<{ status: string; error: string | null }>('GET', `/tasks/${task.id}`);
      status = t.status;
      taskError = t.error;
      if (['done', 'failed', 'denied', 'cancelled', 'rate_limited'].includes(status)) break;
      await sleep(2000);
    }

    check(
      'task done',
      status === 'done',
      status === 'done' ? undefined : `status ${status}${taskError ? `: ${taskError}` : ''}`,
    );

    const file = join(workDir, 'hello.txt');
    const content = existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
    check(
      'hello.txt content',
      content === 'hello from agent-band',
      content === null ? 'file missing' : `got "${content}"`,
    );

    const runs = await api<{ items: { inputTokens: number; outputTokens: number; error: string | null }[] }>(
      'GET',
      `/runs?taskId=${task.id}`,
    );
    const run = runs.items[0];
    check('run recorded', run !== undefined);
    if (run) {
      check('input tokens > 0', run.inputTokens > 0, `${run.inputTokens}`);
      check('output tokens > 0', run.outputTokens > 0, `${run.outputTokens}`);
      if (run.error) check('run error empty', false, run.error);
    }

    const audit = await api<{ items: { action: string }[] }>('GET', '/audit?limit=200');
    const actions = new Set(audit.items.map((e) => e.action));
    for (const action of ['run.start', 'run.finish', ...(isClaude ? ['agent.tool_decision'] : [])]) {
      check(`audit has ${action}`, actions.has(action));
    }
    const verify = await api<{ ok: boolean; count: number }>('GET', '/audit/verify');
    check('audit chain verifies', verify.ok, `${verify.count} events`);
  } catch (err) {
    check('smoke run', false, err instanceof Error ? err.message : String(err));
  } finally {
    cleanup();
  }

  console.log(`\nsmoke report (${provider}, config ${configDir})`);
  for (const c of checks)
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? '\nsmoke: OK' : `\nsmoke: FAILED (${failed} check${failed === 1 ? '' : 's'})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
