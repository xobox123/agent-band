import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// Workers re-evaluate this file; the environment keeps the values chosen by the main process.
process.env['AB_E2E_PORT'] ??= String(await freePort());
process.env['AB_E2E_HOME'] ??= mkdtempSync(join(tmpdir(), 'agent-band-e2e-'));
const port = process.env['AB_E2E_PORT'];
const home = process.env['AB_E2E_HOME'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx ../server/src/main.ts',
    url: `http://127.0.0.1:${port}/readyz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AGENT_BAND_PORT: port,
      AGENT_BAND_HOME: home,
      AGENT_BAND_WORKSPACE_ROOT: join(home, 'workspaces'),
      AGENT_BAND_SCHEDULER_INTERVAL_MS: '200',
      LOG_LEVEL: 'warn',
    },
  },
});
