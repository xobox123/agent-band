import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type Database } from '../../../platform/db.ts';
import { withTx } from '../../../platform/tx.ts';
import { authorizer, bootstrapLocalOrg, createPrincipal, orgUseCases } from '../../org/index.ts';
import type { AuditRow } from '../domain/hash.ts';
import { appendAudit, auditLog, createAudit } from '../index.ts';

const at = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('unexpected undefined');
  return v;
};

let database: Database | undefined;
afterEach(async () => {
  await database?.close();
  database = undefined;
});

async function setup() {
  database = await openTestDatabase();
  const db = database.db;
  const boot = await bootstrapLocalOrg(db);
  const audit = createAudit(authorizer);
  const append = (n: number, extra: Partial<{ action: string; targetId: string; actorId: string }> = {}) =>
    withTx(db, (tx) =>
      appendAudit(tx, {
        orgId: boot.orgId,
        actorId: extra.actorId ?? boot.localUser.principalId,
        action: extra.action ?? 'test.event',
        targetType: 'thing',
        targetId: extra.targetId ?? `t${n}`,
        data: { n, nested: { b: 1, a: [1, 2] } },
      }),
    );
  return { db, boot, audit, append };
}

describe('appendAudit', () => {
  it('chains events and verifies', async () => {
    const { db, boot, audit, append } = await setup();
    for (let i = 0; i < 5; i++) await append(i);
    const res = await audit.verifyAudit(db, boot.localUser);
    expect(res.ok).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(5);
  });

  it('50 concurrent appends keep the chain valid', async () => {
    const { db, boot, audit, append } = await setup();
    const before = (await audit.verifyAudit(db, boot.localUser)).count;
    await Promise.all(Array.from({ length: 50 }, (_, i) => append(i)));
    const res = await audit.verifyAudit(db, boot.localUser);
    expect(res).toMatchObject({ ok: true, count: before + 50 });
  });

  it('rolled back transactions leave no audit row', async () => {
    const { db, boot, audit } = await setup();
    const before = (await audit.verifyAudit(db, boot.localUser)).count;
    await expect(
      withTx(db, async (tx) => {
        await appendAudit(tx, {
          orgId: boot.orgId,
          actorId: boot.localUser.principalId,
          action: 'x',
          targetType: 't',
          targetId: '1',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await audit.verifyAudit(db, boot.localUser)).count).toBe(before);
  });

  it('chains orgs independently', async () => {
    const { db, boot, audit, append } = await setup();
    const otherOrg = randomUUID();
    await withTx(db, (tx) =>
      appendAudit(tx, {
        orgId: otherOrg,
        actorId: randomUUID(),
        action: 'a',
        targetType: 't',
        targetId: '1',
      }),
    );
    await append(1);
    expect((await audit.verifyAudit(db, boot.localUser)).ok).toBe(true);
    const other = await db.execute(sql`select prev_hash from audit_events where org_id = ${otherOrg}`);
    expect((other as { rows: { prev_hash: string }[] }).rows[0]?.prev_hash).toBe('0'.repeat(64));
  });

  it('exposes the AuditLog port', async () => {
    const { db, boot, audit } = await setup();
    await withTx(db, (tx) =>
      auditLog.append(tx, {
        orgId: boot.orgId,
        actorId: boot.localUser.principalId,
        action: 'p',
        targetType: 't',
        targetId: '1',
      }),
    );
    expect((await audit.listAudit(db, boot.localUser, { action: 'p' })).items).toHaveLength(1);
  });
});

describe('immutability', () => {
  it('rejects UPDATE and DELETE', async () => {
    const { db, append } = await setup();
    await append(1);
    await expect(db.execute(sql`update audit_events set action = 'hacked'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_events`)).rejects.toThrow();
  });
});

describe('verifyAudit', () => {
  async function tampered() {
    const ctx = await setup();
    for (let i = 0; i < 6; i++) await ctx.append(i);
    const rows = (await ctx.db.execute(sql`select seq from audit_events order by seq`)) as {
      rows: { seq: string }[];
    };
    const seqs = rows.rows.map((r) => Number(r.seq));
    await ctx.db.execute(sql`alter table audit_events disable trigger audit_events_immutable`);
    const victim = at(seqs[seqs.length - 3]);
    await ctx.db.execute(sql`update audit_events set action = 'tampered' where seq = ${victim}`);
    await ctx.db.execute(sql`alter table audit_events enable trigger audit_events_immutable`);
    return { ...ctx, seqs, victim };
  }

  it('detects a tampered event', async () => {
    const { db, boot, audit, victim } = await tampered();
    expect(await audit.verifyAudit(db, boot.localUser)).toMatchObject({ ok: false, brokenAtSeq: victim });
  });

  it('honours fromSeq/toSeq and reports the range checked', async () => {
    const { db, boot, audit, seqs, victim } = await tampered();
    const first = at(seqs[0]);
    const last = at(seqs[seqs.length - 1]);
    // range before the tampered row is fine
    const before = await audit.verifyAudit(db, boot.localUser, { toSeq: victim - 1 });
    expect(before).toMatchObject({ ok: true, fromSeq: first, toSeq: victim - 1 });
    expect(before.count).toBe(seqs.filter((s) => s < victim).length);
    // range after the tampered row is fine as well (starts from stored prev hash)
    const after = await audit.verifyAudit(db, boot.localUser, { fromSeq: victim + 1 });
    expect(after).toMatchObject({ ok: true, fromSeq: victim + 1, toSeq: last });
    // range covering the victim is broken
    expect(await audit.verifyAudit(db, boot.localUser, { fromSeq: victim, toSeq: last })).toMatchObject({
      ok: false,
      brokenAtSeq: victim,
    });
    // empty range
    expect(await audit.verifyAudit(db, boot.localUser, { fromSeq: last + 100 })).toEqual({
      ok: true,
      count: 0,
      fromSeq: null,
      toSeq: null,
    });
  });

  it('requires read', async () => {
    const { db, boot, audit } = await setup();
    const stranger = { ...boot.localUser, principalId: randomUUID() };
    await expect(audit.verifyAudit(db, stranger)).rejects.toMatchObject({ status: 403 });
  });
});

describe('listAudit', () => {
  it('filters and paginates newest first with a cursor', async () => {
    const { db, boot, audit, append } = await setup();
    for (let i = 0; i < 7; i++) await append(i, { action: i % 2 ? 'odd' : 'even', targetId: `x${i}` });
    const p1 = await audit.listAudit(db, boot.localUser, { action: 'even', limit: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p1.items.every((i) => i.action === 'even')).toBe(true);
    expect(p1.nextCursor).toBe(at(p1.items[2]).seq);
    const p2 = await audit.listAudit(db, boot.localUser, {
      action: 'even',
      limit: 3,
      cursor: at(p1.nextCursor ?? undefined),
    });
    expect(p2.items.map((i) => i.targetId)).toEqual(['x0']);
    expect(p2.nextCursor).toBeNull();
    const byTarget = await audit.listAudit(db, boot.localUser, { targetType: 'thing', targetId: 'x3' });
    expect(byTarget.items).toHaveLength(1);
    const future = await audit.listAudit(db, boot.localUser, {
      from: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.items).toHaveLength(0);
    const all = await audit.listAudit(db, boot.localUser, {
      to: new Date(Date.now() + 1000).toISOString(),
      limit: 200,
    });
    expect(all.items.length).toBeGreaterThanOrEqual(7);
    await expect(audit.listAudit(db, boot.localUser, { limit: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('filters by actor and never leaks other orgs', async () => {
    const { db, boot, audit, append } = await setup();
    const other = randomUUID();
    await withTx(db, (tx) =>
      appendAudit(tx, {
        orgId: other,
        actorId: randomUUID(),
        action: 'foreign',
        targetType: 't',
        targetId: '1',
      }),
    );
    await append(1);
    expect((await audit.listAudit(db, boot.localUser, { action: 'foreign' })).items).toHaveLength(0);
    const mine = await audit.listAudit(db, boot.localUser, {
      actorId: boot.localUser.principalId,
      limit: 200,
    });
    expect(mine.items.every((i) => i.orgId === boot.orgId)).toBe(true);
  });
});

describe('exportAudit', () => {
  async function collect(it: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const l of it) out.push(l);
    return out;
  }

  it('exports JSONL in order and honours filters and toSeq', async () => {
    const { db, boot, audit, append } = await setup();
    for (let i = 0; i < 4; i++) await append(i, { action: 'exp' });
    const lines = await collect(audit.exportAudit(db, boot.localUser, { action: 'exp' }));
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.endsWith('\n'))).toBe(true);
    const parsed = lines.map((l) => JSON.parse(l) as { seq: number; action: string; data: { n: number } });
    expect(parsed.map((p) => p.data.n)).toEqual([0, 1, 2, 3]);
    const bounded = await collect(
      audit.exportAudit(db, boot.localUser, { action: 'exp', toSeq: at(parsed[1]).seq }),
    );
    expect(bounded).toHaveLength(2);
  });

  it('is a snapshot bounded at start when toSeq is omitted', async () => {
    const { db, boot, audit, append } = await setup();
    for (let i = 0; i < 3; i++) await append(i, { action: 'snap' });
    const it = audit.exportAudit(db, boot.localUser, { action: 'snap' })[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    await append(99, { action: 'snap' });
    const rest: string[] = [first.value as string];
    for (let r = await it.next(); !r.done; r = await it.next()) rest.push(r.value);
    expect(rest).toHaveLength(3);
  });

  it('exports an exported chain that verifies on its own', async () => {
    const { db, boot, audit, append } = await setup();
    for (let i = 0; i < 3; i++) await append(i);
    const lines = await collect(audit.exportAudit(db, boot.localUser));
    const { verifyChain } = await import('../domain/hash.ts');
    const rows = lines.map((l) => JSON.parse(l) as AuditRow);
    expect(verifyChain(rows).ok).toBe(true);
  });

  it('requires audit.export', async () => {
    const { db, boot, audit } = await setup();
    const { id } = await withTx(db, (tx) =>
      createPrincipal(tx, { orgId: boot.orgId, kind: 'user', handle: 'user:admin', displayName: 'a' }),
    );
    await orgUseCases.createRoleBinding(db, boot.localUser, {
      subject: { userId: id },
      role: 'admin',
      scope: { org: true },
    });
    const admin = { ...boot.localUser, principalId: id };
    await expect(collect(audit.exportAudit(db, admin))).rejects.toMatchObject({ status: 403 });
  });
});
