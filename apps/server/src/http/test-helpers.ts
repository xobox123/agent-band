import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createComposition, type Composition } from '../composition.ts';
import { fixedKeySource } from '../modules/accounts/index.ts';
import type { ActorContext } from '../platform/actor.ts';
import { openTestDatabase, type Database } from '../platform/db.ts';
import { withTx } from '../platform/tx.ts';
import { buildApp } from './app.ts';

export const TEST_SECRET = 'sk-test-super-secret-value-123';

export interface TestApi {
  app: FastifyInstance;
  c: Composition;
  database: Database;
  /** Acts as another actor for the following requests; `null` restores the local owner. */
  as(actor: ActorContext | null): void;
  /** Creates a user principal with a binding of the given role at org scope and returns its actor. */
  makeUser(handle: string, role: 'viewer' | 'operator' | 'admin'): Promise<ActorContext>;
  close(): Promise<void>;
}

export async function makeApi(opts: { heartbeatMs?: number; webDist?: string } = {}): Promise<TestApi> {
  const database = await openTestDatabase();
  let current: ActorContext | null = null;
  const c = await createComposition({
    database,
    home: mkdtempSync(join(tmpdir(), 'ab-test-')),
    secretKey: fixedKeySource(Buffer.alloc(32, 7)),
    resolveActor: (req, local) => (current ? { ...current, requestId: req.id } : local),
  });
  await c.events.start();
  const app = buildApp({ composition: c, sse: { heartbeatMs: opts.heartbeatMs }, webDist: opts.webDist });
  await app.ready();
  return {
    app,
    c,
    database,
    as(actor) {
      current = actor;
    },
    async makeUser(handle, role) {
      const { id } = await withTx(database.db, (tx) =>
        c.ports.principalRegistry.create(tx, {
          orgId: c.orgId,
          kind: 'user',
          handle,
          displayName: handle,
        }),
      );
      await c.org.createRoleBinding(database.db, c.localUser, {
        subject: { userId: id },
        role,
        scope: { org: true },
      });
      return { orgId: c.orgId, principalId: id, kind: 'user', requestId: 'test' };
    },
    async close() {
      await app.close();
      await c.events.stop();
      await database.close();
    },
  };
}
