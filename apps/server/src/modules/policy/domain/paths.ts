import { posix } from 'node:path';

function normalise(p: string): string | undefined {
  if (!posix.isAbsolute(p) || p.includes('\0')) return undefined;
  return posix.normalize(p);
}

export function isPathWithin(target: string, root: string): boolean {
  const t = normalise(target);
  const r = normalise(root);
  if (t === undefined || r === undefined) return false;
  const rel = posix.relative(r, t);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel));
}

export function isPathAllowed(target: string, rootSets: string[][]): boolean {
  return rootSets.every((roots) => roots.some((root) => isPathWithin(target, root)));
}
