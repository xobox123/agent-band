import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export function canonicalJson(v: unknown): string {
  const sorted = sortKeys(v);
  return sorted === undefined ? 'null' : JSON.stringify(sorted);
}

function sortKeys(v: unknown): unknown {
  if (v !== null && typeof v === 'object') {
    const toJson = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') return sortKeys((toJson as () => unknown).call(v));
    if (Array.isArray(v)) return v.map((x) => sortKeys(x));
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    }
    return out;
  }
  return v;
}

export interface AuditHashInput {
  seq: number;
  orgId: string;
  ts: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  data: unknown;
}

export type AuditRow = AuditHashInput & { prevHash: string; hash: string };

export function auditHash(prevHash: string, e: AuditHashInput): string {
  // Pick the hashed fields explicitly so stored rows with extra columns hash identically.
  const { seq, orgId, ts, actorId, action, targetType, targetId, data } = e;
  const body = canonicalJson({ seq, orgId, ts, actorId, action, targetType, targetId, data });
  return createHash('sha256')
    .update(prevHash + body)
    .digest('hex');
}

export function verifyChain(
  events: AuditRow[],
  startPrev: string = GENESIS_HASH,
): { ok: true } | { ok: false; brokenAtSeq: number } {
  let prev = startPrev;
  for (const e of events) {
    if (e.prevHash !== prev || auditHash(e.prevHash, e) !== e.hash) {
      return { ok: false, brokenAtSeq: e.seq };
    }
    prev = e.hash;
  }
  return { ok: true };
}
