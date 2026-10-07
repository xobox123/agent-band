import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CliLocator,
  cliCommand,
  knownDirs,
  getCliLocator,
  setCliLocator,
  withCliPath,
} from './cli-locator.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ab-loc-'));
});
const original = getCliLocator();
afterEach(() => {
  setCliLocator(original);
});

function script(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}
const fakeCli = (dir: string, name = 'claude', version = '2.1.7 (Claude Code)') =>
  script(dir, name, `echo "${version}"`);

const isolated = (extra: ConstructorParameters<typeof CliLocator>[0] = {}) =>
  new CliLocator({
    env: { PATH: '', HOME: root },
    home: root,
    shell: '/nonexistent-shell',
    knownDirs: [],
    ...extra,
  });

/** The default list restricted to the fake home, so the real machine is never consulted. */
const homeDirs = () => knownDirs(root, { HOME: root }).filter((d) => d.startsWith(root));

describe('CliLocator', () => {
  it('prefers the explicit override and reads the version', async () => {
    const bin = fakeCli(join(root, 'custom'));
    const d = await isolated({ overrides: { claude: bin } }).detect('claude');
    expect(d).toEqual({ binary: bin, version: '2.1.7', source: 'env' });
  });

  it('reports an override that is not executable', async () => {
    const path = join(root, 'plain');
    writeFileSync(path, 'x');
    const d = await isolated({ overrides: { codex: path } }).detect('codex');
    expect(d.binary).toBeNull();
    expect(d.error).toContain('AGENT_BAND_CODEX_BIN');
  });

  it('finds the binary on PATH', async () => {
    const bin = fakeCli(join(root, 'onpath'), 'codex', 'codex-cli 0.160.1');
    const d = await isolated({ env: { PATH: `/nonexistent:${join(root, 'onpath')}`, HOME: root } }).detect(
      'codex',
    );
    expect(d).toEqual({ binary: bin, version: '0.160.1', source: 'path' });
  });

  it('asks the login shell when PATH lacks the binary', async () => {
    const bin = fakeCli(join(root, 'shellbin'));
    const shell = script(join(root, 'sh'), 'fakeshell', `echo "banner"\necho ${bin}`);
    const d = await isolated({ shell }).detect('claude');
    expect(d).toMatchObject({ binary: bin, source: 'shell' });
  });

  it('gives up on a slow login shell and falls back to known locations', async () => {
    const bin = fakeCli(join(root, '.local', 'bin'));
    const shell = script(join(root, 'sh'), 'slowshell', 'sleep 5');
    const started = Date.now();
    const d = await isolated({ shell, shellTimeoutMs: 100, knownDirs: [join(root, '.local', 'bin')] }).detect(
      'claude',
    );
    expect(d).toMatchObject({ binary: bin, source: 'known' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('finds the binary in the default known directories of a home', async () => {
    const bin = fakeCli(join(root, '.local', 'bin'));
    const d = await new CliLocator({
      env: { PATH: '', HOME: root },
      home: root,
      shell: '/nonexistent-shell',
      knownDirs: homeDirs(),
    }).detect('claude');
    expect(d).toMatchObject({ binary: bin, source: 'known' });
  });

  it('finds the newest nvm node bin', async () => {
    fakeCli(join(root, '.nvm', 'versions', 'node', 'v20.1.0', 'bin'), 'codex');
    const bin = fakeCli(join(root, '.nvm', 'versions', 'node', 'v22.3.0', 'bin'), 'codex');
    const d = await new CliLocator({
      env: { PATH: '', HOME: root },
      home: root,
      shell: '/nonexistent-shell',
      knownDirs: homeDirs(),
    }).detect('codex');
    expect(d).toMatchObject({ binary: bin, source: 'known' });
  });

  it('explains how to fix a missing CLI', async () => {
    const d = await isolated().detect('claude');
    expect(d).toEqual({
      binary: null,
      version: null,
      source: null,
      error: 'Claude Code CLI not found. Install it or set AGENT_BAND_CLAUDE_BIN',
    });
  });

  it('puts the resolved directory first in PATH and spawns the absolute path', async () => {
    const dir = join(root, 'tools');
    const bin = fakeCli(dir);
    const locator = isolated({ overrides: { claude: bin } });
    setCliLocator(locator);
    expect(cliCommand('claude')).toBe('claude');
    await locator.detectAll();
    expect(cliCommand('claude')).toBe(bin);
    expect(cliCommand('codex')).toBe('codex');
    expect(withCliPath('claude', { PATH: `/usr/bin:${dir}:/bin` }).PATH).toBe(`${dir}:/usr/bin:/bin`);
    expect(withCliPath('codex', { PATH: '/usr/bin' }).PATH).toBe('/usr/bin');
  });

  it('detects again on demand', async () => {
    const dir = join(root, 'late');
    const locator = isolated({ env: { PATH: dir, HOME: root } });
    expect((await locator.ensure('claude')).binary).toBeNull();
    fakeCli(dir);
    expect((await locator.ensure('claude')).binary).toBeNull();
    expect((await locator.detect('claude')).binary).toBe(join(dir, 'claude'));
  });
});
