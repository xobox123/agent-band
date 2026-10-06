import { createHash } from 'node:crypto';

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

export function stableHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(value)))
    .digest('hex');
}
