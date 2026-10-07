import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CliLocator, getCliLocator, setCliLocator } from '../../runner/index.ts';
import { makeApi, type TestApi } from '../test-helpers.ts';

let api: TestApi;
const original = getCliLocator();
beforeEach(async () => {
  api = await makeApi();
});
afterEach(async () => {
  setCliLocator(original);
  await api.close();
});

it('reports where each CLI was found and detects again on POST', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-diag-'));
  setCliLocator(
    new CliLocator({ env: { PATH: dir, HOME: dir }, home: dir, shell: '/nonexistent-shell', knownDirs: [] }),
  );
  const first = await api.app.inject({ method: 'GET', url: '/api/v1/providers/diagnostics' });
  expect(first.statusCode).toBe(200);
  expect(first.json()).toMatchObject({
    claude: { binary: null, error: 'Claude Code CLI not found. Install it or set AGENT_BAND_CLAUDE_BIN' },
    openai: { binary: null },
    gemini: { binary: null },
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\necho "codex-cli 0.160.1"\n');
  chmodSync(join(dir, 'codex'), 0o755);
  const again = await api.app.inject({ method: 'POST', url: '/api/v1/providers/diagnostics' });
  expect(again.statusCode).toBe(200);
  expect(again.json()).toMatchObject({
    openai: { binary: join(dir, 'codex'), version: '0.160.1', source: 'path' },
    claude: { binary: null },
  });
});
