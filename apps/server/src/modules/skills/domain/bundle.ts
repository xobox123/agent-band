import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { invalid } from '../../../platform/errors.ts';

export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
export const MAX_BUNDLE_FILES = 500;
export const SKILL_FILE = 'SKILL.md';

export type BundleFiles = Map<string, Uint8Array>;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function decodeBase64(value: string, what: string): Uint8Array {
  const compact = value.replace(/\s+/g, '');
  if (compact.length % 4 !== 0 || !BASE64.test(compact)) {
    throw invalid([{ path: what, message: 'not valid base64' }]);
  }
  return new Uint8Array(Buffer.from(compact, 'base64'));
}

export function validateBundlePath(path: string): void {
  const bad = (message: string) => invalid([{ path, message }]);
  if (path.length === 0 || path.length > 255) throw bad('path length must be 1..255');
  if (path.includes('\0') || path.includes('\\')) throw bad('path contains forbidden characters');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) throw bad('path must be relative');
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') throw bad('path contains an invalid segment');
  }
}

export function normalizeBundle(entries: Iterable<[string, Uint8Array]>): BundleFiles {
  const files: BundleFiles = new Map();
  let total = 0;
  for (const [path, content] of entries) {
    validateBundlePath(path);
    if (files.has(path)) throw invalid([{ path, message: 'duplicate path' }]);
    total += content.byteLength;
    if (total > MAX_BUNDLE_BYTES) throw invalid([{ message: 'bundle exceeds 5 MB' }]);
    files.set(path, content);
  }
  if (files.size > MAX_BUNDLE_FILES)
    throw invalid([{ message: `bundle has more than ${MAX_BUNDLE_FILES} files` }]);
  if (!files.has(SKILL_FILE))
    throw invalid([{ path: SKILL_FILE, message: 'SKILL.md is required at the bundle root' }]);
  return files;
}

export function bundleFromFilesMap(map: Record<string, string>): BundleFiles {
  return normalizeBundle(
    Object.entries(map).map(([p, b64]) => [p, decodeBase64(b64, p)] as [string, Uint8Array]),
  );
}

export function bundleFromZip(zipBase64: string): BundleFiles {
  const raw = decodeBase64(zipBase64, 'zip');
  if (raw.byteLength > MAX_BUNDLE_BYTES) throw invalid([{ message: 'bundle exceeds 5 MB' }]);
  let seen = 0;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(raw, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        seen += f.originalSize;
        if (seen > MAX_BUNDLE_BYTES) throw invalid([{ message: 'bundle exceeds 5 MB' }]);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AppError') throw err;
    throw invalid([{ path: 'zip', message: 'not a valid zip archive' }]);
  }
  return normalizeBundle(Object.entries(out));
}

function sortedEntries(files: BundleFiles): [string, Uint8Array][] {
  return [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** sha256 over the path-sorted list of length-framed (path, content) pairs. */
export function contentHashOf(files: BundleFiles): string {
  const h = createHash('sha256');
  for (const [path, content] of sortedEntries(files)) {
    const p = Buffer.from(path, 'utf8');
    h.update(`${p.byteLength}:`).update(p).update(`${content.byteLength}:`).update(content);
  }
  return h.digest('hex');
}

export function bundleSize(files: BundleFiles): number {
  let n = 0;
  for (const c of files.values()) n += c.byteLength;
  return n;
}

export function packBundle(files: BundleFiles): Uint8Array {
  return zipSync(Object.fromEntries(sortedEntries(files)), { mtime: Date.UTC(1980, 0, 1) });
}

export function unpackBundle(packed: Uint8Array): BundleFiles {
  return new Map(Object.entries(unzipSync(packed)));
}

export function skillSourceFiles(input: { files?: Record<string, string>; zip?: string }): BundleFiles {
  if ((input.files === undefined) === (input.zip === undefined)) {
    throw invalid([{ message: 'provide exactly one of files or zip' }]);
  }
  return input.files !== undefined ? bundleFromFilesMap(input.files) : bundleFromZip(input.zip as string);
}
