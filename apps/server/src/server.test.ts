import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createComposition } from './composition.ts';
import { fixedKeySource } from './modules/accounts/index.ts';
import { openTestDatabase } from './platform/db.ts';
import { startAll } from './roles/all.ts';
import { startApi } from './roles/api.ts';
import { loadConfig } from './platform/config.ts';
import { start } from './server.ts';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => {
        resolve(port);
      });
    });
  });
}

it('boots with a temp AGENT_BAND_HOME, serves readyz, the API and the SPA, and stops cleanly', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  const dist = join(home, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html>spa</html>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');

  const config = loadConfig({
    AGENT_BAND_HOME: home,
    AGENT_BAND_PORT: String(await freePort()),
    LOG_LEVEL: 'silent',
  });
  const server = await start(config, { webDist: dist });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const org = await fetch(`${base}/api/v1/organization`);
    expect(org.status).toBe(200);
    expect((await fetch(`${base}/some/spa/route`)).headers.get('content-type')).toContain('text/html');
    expect(await (await fetch(`${base}/some/spa/route`)).text()).toContain('spa');
    expect((await fetch(`${base}/assets/app.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${base}/assets/../../etc/passwd`)).status).toBe(200);
    const missingApi = await fetch(`${base}/api/v1/nope`);
    expect(missingApi.status).toBe(404);
    expect(missingApi.headers.get('content-type')).toContain('application/problem+json');
  } finally {
    await server.stop();
  }
  await expect(fetch(`${base}/readyz`)).rejects.toThrow();
});

it('role all starts a worker with no active runs and stops it cleanly', async () => {
  const database = await openTestDatabase();
  const home = mkdtempSync(join(tmpdir(), 'ab-all-'));
  const config = loadConfig({
    AGENT_BAND_HOME: home,
    AGENT_BAND_PORT: String(await freePort()),
    AGENT_BAND_WORKER_ID: 'test-worker',
    LOG_LEVEL: 'silent',
  });
  const composition = await createComposition({
    database,
    home,
    secretKey: fixedKeySource(Buffer.alloc(32, 7)),
  });
  const all = await startAll(config, composition);
  try {
    expect(all.worker.worker.activeRuns).toBe(0);
    expect((await fetch(`http://127.0.0.1:${all.api.port}/readyz`)).status).toBe(200);
  } finally {
    await all.stop();
    await database.close();
  }
});

it('role api runs the scheduler loop and stops it with the role', async () => {
  const database = await openTestDatabase();
  const home = mkdtempSync(join(tmpdir(), 'ab-sched-'));
  const config = loadConfig({
    AGENT_BAND_HOME: home,
    AGENT_BAND_PORT: String(await freePort()),
    AGENT_BAND_SCHEDULER_INTERVAL_MS: '100',
    LOG_LEVEL: 'silent',
  });
  const composition = await createComposition({
    database,
    home,
    secretKey: fixedKeySource(Buffer.alloc(32, 7)),
  });
  const api = await startApi(config, composition);
  try {
    const future = new Date(Date.now() + 400);
    await composition.tasks.createTask(database.db, composition.localUser, {
      title: 't',
      prompt: 'p',
      workDir: '/w',
      target: { label: 'x' },
      runAt: future,
    });
    let status = 'scheduled';
    for (let i = 0; i < 60 && status === 'scheduled'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = (await composition.tasks.listTasks(database.db, composition.localUser))[0]?.status ?? status;
    }
    expect(status).toBe('queued');
  } finally {
    await api.stop();
    await database.close();
  }
});

it('runs as a real process via main.ts and exits 0 on SIGTERM', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-proc-'));
  const port = await freePort();
  const main = fileURLToPath(new URL('./main.ts', import.meta.url));
  const child = spawn('npx', ['tsx', main], {
    env: {
      ...process.env,
      AGENT_BAND_HOME: home,
      AGENT_BAND_PORT: String(port),
      AGENT_BAND_ROLE: 'all',
      LOG_LEVEL: 'silent',
    },
    stdio: 'ignore',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  try {
    let ready = false;
    for (let i = 0; i < 250 && !ready; i++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/readyz`)).status === 200;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    expect(ready).toBe(true);
  } finally {
    child.kill('SIGTERM');
  }
  expect(await exited).toBe(0);
}, 90_000);
