// Cross-module ports. Modules depend on these interfaces, never on each other's internals.
// Real implementations are wired in the composition root; tests use ./testing.ts.
import type { ActorContext } from '../platform/actor.ts';
import type { Db } from '../platform/db.ts';
import type { Tx } from '../platform/tx.ts';
import type { Action, ResourceRef } from '../modules/org/domain/rbac.ts';
import type { EffectivePolicy } from '../modules/policy/domain/rules.ts';
import type { CreateTaskInput } from '../modules/tasks/index.ts';

export type DbOrTx = Db | Tx;

export interface Authorizer {
  /** Throws AppError 403 (code "forbidden") and records `authz.denied` when not allowed. */
  authorize(db: DbOrTx, actor: ActorContext, action: Action, resource: ResourceRef): Promise<void>;
}

export interface AuditEntry {
  orgId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  data?: unknown;
}

export interface AuditLog {
  /** Must be called inside the transaction that performs the audited change. */
  append(tx: Tx, entry: AuditEntry): Promise<void>;
}

export interface PrincipalRegistry {
  create(
    tx: Tx,
    p: {
      orgId: string;
      kind: 'user' | 'agent' | 'system';
      handle: string;
      displayName: string;
      avatar?: string;
    },
  ): Promise<{ id: string }>;
}

/** Group membership of agents, owned by the agents module. */
export interface AgentMembership {
  groupIdsOf(db: DbOrTx, agentId: string): Promise<string[]>;
}

/** Where policies are bound for an agent, owned by org + agents modules. */
export interface PolicyBindings {
  forAgent(
    db: DbOrTx,
    agentId: string,
  ): Promise<{
    orgPolicyId: string | null;
    groups: { groupId: string; policyId: string | null }[];
    agentPolicyId: string | null;
  }>;
}

/** Organisation settings needed by other modules, owned by the org module. */
export interface OrgSettings {
  get(db: DbOrTx, orgId: string): Promise<{ taskKeyPrefix: string; timezone: string }>;
}

/** Effective policy of an agent (org + groups + agent merged), owned by the policy module. */
export interface EffectivePolicySource {
  forAgent(db: DbOrTx, orgId: string, agentId: string): Promise<EffectivePolicy>;
}

export interface EffectiveSkill {
  skillId: string;
  name: string;
  version: number;
  contentHash: string;
}

/** Effective skills of an agent and their file bundles, owned by the skills module. */
export interface EffectiveSkillsSource {
  forAgent(db: DbOrTx, orgId: string, agentId: string): Promise<EffectiveSkill[]>;
  loadBundle(
    db: DbOrTx,
    orgId: string,
    skillId: string,
    version: number,
  ): Promise<Record<string, Uint8Array>>;
}

/** Task operations the scheduler needs, owned by the tasks module. */
export interface TaskPlanner {
  createTask(tx: Tx, actor: ActorContext, input: CreateTaskInput): Promise<{ id: string; status: string }>;
  hasOpenTaskOfSchedule(tx: Tx, actor: ActorContext, scheduleId: string): Promise<boolean>;
  releaseDueScheduled(tx: Tx, actor: ActorContext, now: Date): Promise<{ id: string }[]>;
  resumeDueRateLimited(
    tx: Tx,
    actor: ActorContext,
    now: Date,
  ): Promise<{ resumed: { id: string }[]; exhausted: { id: string }[] }>;
}

export interface RunEventWriter {
  appendRunEvent(
    tx: Tx,
    actor: ActorContext,
    id: string,
    event: import('@agent-band/contracts').NormalizedEvent,
  ): Promise<unknown>;
}

export interface ModuleDeps {
  authorizer: Authorizer;
  audit: AuditLog;
}
