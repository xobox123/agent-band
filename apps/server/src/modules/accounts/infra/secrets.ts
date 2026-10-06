import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = 'v1';
const KEY_BYTES = 32;

export type SecretKeySource = () => Buffer;

export function fixedKeySource(key: Buffer): SecretKeySource {
  if (key.length !== KEY_BYTES) throw new Error(`secret key must be ${KEY_BYTES} bytes`);
  return () => key;
}

function decodeKey(b64: string, origin: string): Buffer {
  const key = Buffer.from(b64.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new Error(`${origin} must be base64 of ${KEY_BYTES} bytes`);
  return key;
}

/** AGENT_BAND_SECRET_KEY wins; otherwise <home>/secret.key, created with mode 0600 on first use. */
export function envOrFileKeySource(opts: { env?: NodeJS.ProcessEnv; home: string }): SecretKeySource {
  let cached: Buffer | undefined;
  return () => {
    if (cached) return cached;
    const fromEnv = (opts.env ?? process.env)['AGENT_BAND_SECRET_KEY'];
    if (fromEnv) {
      cached = decodeKey(fromEnv, 'AGENT_BAND_SECRET_KEY');
      return cached;
    }
    const file = join(opts.home, 'secret.key');
    try {
      cached = decodeKey(readFileSync(file, 'utf8'), file);
      return cached;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    mkdirSync(opts.home, { recursive: true, mode: 0o700 });
    const key = randomBytes(KEY_BYTES);
    try {
      writeFileSync(file, key.toString('base64'), { flag: 'wx', mode: 0o600 });
      cached = key;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      cached = decodeKey(readFileSync(file, 'utf8'), file);
    }
    return cached;
  };
}

/** Output: v1.<iv>.<tag>.<ciphertext> (base64url). `aad` binds the ciphertext to its owner row. */
export function encryptSecret(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

export function decryptSecret(key: Buffer, encoded: string, aad: string): string {
  const [version, iv, tag, ct] = encoded.split('.');
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error('malformed secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
