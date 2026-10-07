import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AuthorizeToolRequest } from '@agent-band/contracts';
import type { Db } from '../../platform/db.ts';
import type { Tx } from '../../platform/tx.ts';
import type { AuditLog, RunEventWriter } from '../../ports/index.ts';
import { decideTool, type ToolDecision, type ToolPolicySnapshot } from '../domain/tool-authz.ts';
import { runAuth } from '../infra/schema.ts';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const newRunToken = (): string => randomBytes(32).toString('hex');

export async function registerRunAuth(
  tx: Tx,
  input: {
    runId: string;
    orgId: string;
    agentId: string;
    workDir: string;
    token: string;
    policy: ToolPolicySnapshot;
  },
): Promise<void> {
  await tx.insert(runAuth).values({
    runId: input.runId,
    orgId: input.orgId,
    agentId: input.agentId,
    workDir: input.workDir,
    tokenHash: hashToken(input.token),
    policy: input.policy,
  });
}

export async function revokeRunAuth(tx: Tx, runId: string): Promise<void> {
  await tx.delete(runAuth).where(eq(runAuth.runId, runId));
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns the run's identity when the token matches, otherwise null. */
export async function verifyRunToken(
  db: Db | Tx,
  runId: string,
  token: string,
): Promise<{ runId: string; orgId: string; agentId: string; workDir: string } | null> {
  const [row] = await db.select().from(runAuth).where(eq(runAuth.runId, runId));
  if (!row || !token || !tokenMatches(token, row.tokenHash)) return null;
  return { runId: row.runId, orgId: row.orgId, agentId: row.agentId, workDir: row.workDir };
}

/** Finds the run a token was issued for; the caller must still verify it with verifyRunToken. */
export async function findRunIdByToken(db: Db | Tx, token: string): Promise<string | null> {
  if (!token) return null;
  const [row] = await db
    .select({ runId: runAuth.runId })
    .from(runAuth)
    .where(eq(runAuth.tokenHash, hashToken(token)));
  return row?.runId ?? null;
}

export type ToolCall = Pick<AuthorizeToolRequest, 'toolName' | 'toolInput' | 'toolUseId'>;

/**
 * Decides one tool call of a running agent. Unknown run, revoked run and bad token all
 * deny without an audit record, because the caller is not a proven agent.
 */
export function createAuthorizeToolCall(deps: { audit: AuditLog; runs: RunEventWriter }) {
  return async function authorizeToolCall(
    db: Db,
    runId: string,
    token: string,
    tool: ToolCall,
  ): Promise<ToolDecision> {
    const [row] = await db.select().from(runAuth).where(eq(runAuth.runId, runId));
    if (!row || !token || !tokenMatches(token, row.tokenHash)) {
      return { decision: 'deny', reason: 'invalid run token' };
    }
    const result = decideTool(row.policy, row.workDir, tool.toolName, tool.toolInput);
    await db.transaction(async (tx) => {
      await deps.runs.appendRunEvent(
        tx,
        { orgId: row.orgId, principalId: row.agentId, kind: 'system', requestId: runId },
        runId,
        { kind: 'tool_decision', ...result, ...(tool.toolUseId ? { toolUseId: tool.toolUseId } : {}) },
      );
      await deps.audit.append(tx, {
        orgId: row.orgId,
        actorId: row.agentId,
        action: 'agent.tool_decision',
        targetType: 'run',
        targetId: runId,
        data: {
          tool: tool.toolName,
          decision: result.decision,
          reason: result.reason,
          input: JSON.stringify(tool.toolInput ?? null).slice(0, 2000),
          ...(tool.toolUseId ? { toolUseId: tool.toolUseId } : {}),
        },
      });
    });
    return result;
  };
}
