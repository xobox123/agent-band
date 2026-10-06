import { describe, expect, it } from 'vitest';
import { type AuditRow, GENESIS_HASH, auditHash, canonicalJson, verifyChain } from './hash.ts';

describe('canonicalJson', () => {
  it('is independent of key order, recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: [{ y: 1, x: 2 }] } })).toBe(
      canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 1 }, b: 1 }),
    );
  });

  it('has no whitespace and sorted keys', () => {
    expect(canonicalJson({ b: [1, 'x'], a: null })).toBe('{"a":null,"b":[1,"x"]}');
  });

  it('drops undefined object members and keeps array order', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('renders undefined array members as null and top-level undefined as null', () => {
    expect(canonicalJson([undefined])).toBe('[null]');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

function at<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element at ${i}`);
  return x;
}

const base = {
  orgId: 'o',
  ts: '2026-10-06T00:00:00.000Z',
  actorId: 'user:local',
  action: 'task.create',
  targetType: 'task',
  targetId: 't1',
  data: { k: 1 },
};

function chain(n: number) {
  const out: AuditRow[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e = { ...base, seq, data: { n: seq } };
    const hash = auditHash(prev, e);
    out.push({ ...e, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('auditHash', () => {
  it('is a sha256 hex digest', () => {
    expect(auditHash(GENESIS_HASH, { ...base, seq: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is independent of data key order and depends on prevHash and fields', () => {
    const a = auditHash(GENESIS_HASH, { ...base, seq: 1, data: { x: 1, y: 2 } });
    expect(auditHash(GENESIS_HASH, { ...base, seq: 1, data: { y: 2, x: 1 } })).toBe(a);
    expect(auditHash('1'.repeat(64), { ...base, seq: 1, data: { x: 1, y: 2 } })).not.toBe(a);
    expect(auditHash(GENESIS_HASH, { ...base, seq: 2, data: { x: 1, y: 2 } })).not.toBe(a);
  });
});

describe('verifyChain', () => {
  it('accepts empty and intact chains', () => {
    expect(verifyChain([])).toEqual({ ok: true });
    expect(verifyChain(chain(5))).toEqual({ ok: true });
  });

  it('detects a tampered middle event', () => {
    const c = chain(5);
    c[2] = { ...at(c, 2), data: { n: 999 } };
    expect(verifyChain(c)).toEqual({ ok: false, brokenAtSeq: 3 });
  });

  it('detects a broken link even when the hash was recomputed', () => {
    const c = chain(4);
    const forged = { ...at(c, 1), action: 'x' };
    forged.hash = auditHash(forged.prevHash, forged);
    c[1] = forged;
    expect(verifyChain(c)).toEqual({ ok: false, brokenAtSeq: 3 });
  });

  it('detects a wrong first prevHash and supports a custom start', () => {
    const c = chain(3);
    expect(verifyChain(c, '1'.repeat(64))).toEqual({ ok: false, brokenAtSeq: 1 });
    expect(verifyChain(c.slice(1), at(c, 0).hash)).toEqual({ ok: true });
  });

  it('detects a removed event', () => {
    const c = chain(4);
    c.splice(1, 1);
    expect(verifyChain(c)).toEqual({ ok: false, brokenAtSeq: 3 });
  });
});
