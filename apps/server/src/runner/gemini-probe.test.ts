import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeBins } from './fake-cli.testkit.ts';
import { loginCommand, probeAccount, probeApiKey, startLogin } from './probe.ts';

let bins: ReturnType<typeof fakeBins>;
beforeAll(() => {
  bins = fakeBins();
});
afterEach(() => {
  delete process.env.FAKE_MODE;
});

/** A Gemini home root; `.gemini/oauth_creds.json` is a stand-in whose content is never read. */
function home(opts: { creds: boolean; active?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'gemini-home-'));
  mkdirSync(join(root, '.gemini'));
  if (opts.creds) writeFileSync(join(root, '.gemini', 'oauth_creds.json'), 'SECRET-NOT-READ');
  if (opts.active)
    writeFileSync(
      join(root, '.gemini', 'google_accounts.json'),
      JSON.stringify({ active: opts.active, old: [] }),
    );
  return root;
}

describe('gemini login', () => {
  it('uses GEMINI_CLI_HOME for a managed dir and nothing for the default', () => {
    expect(loginCommand('gemini', '/data/accounts/gemini-savigo')).toBe(
      'GEMINI_CLI_HOME=/data/accounts/gemini-savigo gemini',
    );
    expect(loginCommand('gemini', null)).toBe('gemini');
  });

  it('cannot be started headless: it returns the exact command', async () => {
    const handle = await startLogin({ provider: 'gemini', configDir: '/d/gemini-x' }, { bins });
    expect(handle).toMatchObject({ started: false, command: 'GEMINI_CLI_HOME=/d/gemini-x gemini' });
    await expect(handle.done).resolves.toBeUndefined();
  });
});

describe('probeAccount gemini', () => {
  it('is logged in when the credentials file exists, with the cached email', async () => {
    const dir = home({ creds: true, active: 'owner@example.com' });
    const r = await probeAccount({ provider: 'gemini', configDir: dir }, { bins });
    expect(r).toMatchObject({
      loggedIn: true,
      identity: { email: 'owner@example.com', authMethod: 'google-oauth' },
      loginCommand: null,
    });
    expect(r.note).toMatch(/verified on the first run/);
  });

  it('is not logged in without credentials and gives the login command', async () => {
    const dir = home({ creds: false });
    const r = await probeAccount({ provider: 'gemini', configDir: dir }, { bins });
    expect(r.loggedIn).toBe(false);
    expect(r.error).toBeUndefined();
    expect(r.loginCommand).toBe(`GEMINI_CLI_HOME=${dir} gemini`);
  });

  it('reports a missing CLI and a timeout', async () => {
    const dir = home({ creds: true });
    const missing = { gemini: { cmd: '/nonexistent/gemini-cli' } };
    expect((await probeAccount({ provider: 'gemini', configDir: dir }, { bins: missing })).error).toMatch(
      /not found/,
    );
    process.env.FAKE_MODE = 'hang';
    const slow = await probeAccount({ provider: 'gemini', configDir: dir }, { bins, timeoutMs: 300 });
    expect(slow.error).toMatch(/did not answer/);
  });
});

describe('probeApiKey gemini', () => {
  it('accepts a stored key without calling the CLI', async () => {
    const r = await probeApiKey({ provider: 'gemini', configDir: home({ creds: false }), apiKey: 'k' });
    expect(r).toMatchObject({ loggedIn: true, identity: { plan: 'API key' }, loginCommand: null });
    expect(JSON.stringify(r)).not.toContain('"k"');
  });

  it('rejects an empty key', async () => {
    const r = await probeApiKey({ provider: 'gemini', configDir: home({ creds: false }), apiKey: ' ' });
    expect(r.loggedIn).toBe(false);
  });
});
