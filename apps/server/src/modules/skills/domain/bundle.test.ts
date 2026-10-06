import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  MAX_BUNDLE_BYTES,
  bundleFromFilesMap,
  bundleFromZip,
  contentHashOf,
  packBundle,
  unpackBundle,
  validateBundlePath,
} from './bundle.ts';

function rejects(fn: () => unknown, re: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ code: 'validation_failed' });
    expect(JSON.stringify((err as { details?: unknown }).details)).toMatch(re);
    return;
  }
  throw new Error('expected the call to throw');
}

const b64 = (s: string | Uint8Array): string => Buffer.from(s).toString('base64');
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const zip64 = (files: Record<string, string>): string =>
  b64(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)]))));

describe('bundle', () => {
  it('hash is independent of file order and zip vs files map', () => {
    const a = bundleFromFilesMap({ 'SKILL.md': b64('# s'), 'lib/x.py': b64('print(1)') });
    const b = bundleFromFilesMap({ 'lib/x.py': b64('print(1)'), 'SKILL.md': b64('# s') });
    const z = bundleFromZip(zip64({ 'lib/x.py': 'print(1)', 'SKILL.md': '# s' }));
    expect(contentHashOf(a)).toBe(contentHashOf(b));
    expect(contentHashOf(z)).toBe(contentHashOf(a));
    expect(contentHashOf(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash changes with content and path framing is unambiguous', () => {
    const h = (m: Record<string, string>) => contentHashOf(bundleFromFilesMap(m));
    expect(h({ 'SKILL.md': b64('a') })).not.toBe(h({ 'SKILL.md': b64('b') }));
    expect(h({ 'SKILL.md': b64('a'), x: b64('bc') })).not.toBe(h({ 'SKILL.md': b64('a'), xb: b64('c') }));
  });

  it('pack and unpack round-trip', () => {
    const a = bundleFromFilesMap({ 'SKILL.md': b64('# s'), 'a/b.txt': b64('hi') });
    const back = unpackBundle(packBundle(a));
    expect(contentHashOf(back)).toBe(contentHashOf(a));
  });

  it.each(['../evil', 'a/../../evil', '/abs', 'a//b', './a', 'a\\b', 'C:/x', '', 'a/', 'a\0b'])(
    'rejects path %j',
    (p) => {
      expect(() => {
        validateBundlePath(p);
      }).toThrow();
    },
  );

  it('rejects path traversal in a files map and in a zip', () => {
    rejects(() => bundleFromFilesMap({ 'SKILL.md': b64('x'), '../evil.sh': b64('x') }), /invalid segment/);
    rejects(() => bundleFromZip(zip64({ 'SKILL.md': 'x', '../evil.sh': 'x' })), /invalid segment/);
  });

  it('requires SKILL.md at the root', () => {
    rejects(() => bundleFromFilesMap({ 'docs/SKILL.md': b64('x') }), /SKILL.md is required/);
    rejects(() => bundleFromZip(zip64({ 'readme.md': 'x' })), /SKILL.md is required/);
  });

  it('rejects bundles over 5 MB and zip bombs', () => {
    const big = new Uint8Array(MAX_BUNDLE_BYTES + 1);
    rejects(() => bundleFromFilesMap({ 'SKILL.md': b64('x'), 'big.bin': b64(big) }), /5 MB/);
    rejects(() => bundleFromZip(b64(zipSync({ 'SKILL.md': enc('x'), 'zeros.bin': big }))), /5 MB/);
  });

  it('rejects bad base64 and non-zip input', () => {
    rejects(() => bundleFromFilesMap({ 'SKILL.md': '***' }), /base64/);
    rejects(() => bundleFromZip(b64('not a zip at all')), /valid zip/);
  });
});
