import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, envOrFileKeySource, fixedKeySource } from './secrets.ts';

const key = randomBytes(32);

describe('secret encryption', () => {
  it('round-trips and does not contain the plaintext', () => {
    const enc = encryptSecret(key, 'sk-test-123', 'acc-1');
    expect(enc).not.toContain('sk-test-123');
    expect(decryptSecret(key, enc, 'acc-1')).toBe('sk-test-123');
  });

  it('uses a fresh iv per encryption', () => {
    expect(encryptSecret(key, 'a', 'x')).not.toBe(encryptSecret(key, 'a', 'x'));
  });

  it('rejects tampered ciphertext, wrong key and wrong aad', () => {
    const enc = encryptSecret(key, 'secret', 'acc-1');
    const parts = enc.split('.');
    const ct = Buffer.from(parts[3] ?? '', 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 1;
    const tampered = [...parts.slice(0, 3), ct.toString('base64url')].join('.');
    expect(() => decryptSecret(key, tampered, 'acc-1')).toThrow();
    expect(() => decryptSecret(randomBytes(32), enc, 'acc-1')).toThrow();
    expect(() => decryptSecret(key, enc, 'acc-2')).toThrow();
    expect(() => decryptSecret(key, 'garbage', 'acc-1')).toThrow();
  });

  it('fixedKeySource requires 32 bytes', () => {
    expect(() => fixedKeySource(Buffer.alloc(8))).toThrow();
  });
});

describe('envOrFileKeySource', () => {
  it('prefers AGENT_BAND_SECRET_KEY', () => {
    const k = randomBytes(32);
    const src = envOrFileKeySource({
      env: { AGENT_BAND_SECRET_KEY: k.toString('base64') },
      home: '/nonexistent',
    });
    expect(src().equals(k)).toBe(true);
  });

  it('rejects a key of the wrong size', () => {
    const src = envOrFileKeySource({ env: { AGENT_BAND_SECRET_KEY: 'AAAA' }, home: '/nonexistent' });
    expect(() => src()).toThrow();
  });

  it('creates secret.key with mode 0600 and reuses it', () => {
    const home = join(mkdtempSync(join(tmpdir(), 'ab-key-')), 'home');
    const first = envOrFileKeySource({ env: {}, home })();
    const file = join(home, 'secret.key');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(envOrFileKeySource({ env: {}, home })().equals(first)).toBe(true);
    expect(Buffer.from(readFileSync(file, 'utf8'), 'base64').equals(first)).toBe(true);
  });

  it('rejects a corrupt key file', () => {
    const home = mkdtempSync(join(tmpdir(), 'ab-key-'));
    writeFileSync(join(home, 'secret.key'), 'short');
    expect(() => envOrFileKeySource({ env: {}, home })()).toThrow();
  });
});
