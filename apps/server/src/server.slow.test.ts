import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

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
});
