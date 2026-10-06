import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { conflict, invalid } from '../../../platform/errors.ts';
import type { Tx } from '../../../platform/tx.ts';
import type { PrincipalRegistry } from '../../../ports/index.ts';
import { principals, users } from '../infra/schema.ts';

const principalSchema = z.object({
  orgId: z.uuid(),
  kind: z.enum(['user', 'agent', 'system']),
  handle: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  avatar: z.string().max(2000).optional(),
});

export type NewPrincipal = z.input<typeof principalSchema>;

export async function createPrincipal(tx: Tx, input: NewPrincipal): Promise<{ id: string }> {
  const parsed = principalSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues);
  const p = parsed.data;
  const existing = await tx
    .select({ id: principals.id })
    .from(principals)
    .where(and(eq(principals.orgId, p.orgId), eq(principals.handle, p.handle)));
  if (existing.length > 0) throw conflict('handle_taken', `handle ${p.handle} already exists`);
  const rows = await tx
    .insert(principals)
    .values({ orgId: p.orgId, kind: p.kind, handle: p.handle, displayName: p.displayName, avatar: p.avatar })
    .returning({ id: principals.id });
  const row = rows[0];
  if (!row) throw new Error('principal insert returned no row');
  if (p.kind === 'user') await tx.insert(users).values({ principalId: row.id, orgId: p.orgId });
  return { id: row.id };
}

export const principalRegistry: PrincipalRegistry = { create: createPrincipal };
