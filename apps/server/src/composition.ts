import type { FastifyRequest } from 'fastify';
import type { ActorContext } from './platform/actor.ts';
import type { Database } from './platform/db.ts';
import { EventStream, latestOutboxId } from './platform/outbox.ts';
import type { AgentMembership, ModuleDeps, OrgSettings, PolicyBindings } from './ports/index.ts';
import {
  createAccountUseCases,
  envOrFileKeySource,
  listProviders,
  type SecretKeySource,
} from './modules/accounts/index.ts';
import {
  accountHasAgents,
  createAgentMembership,
  createAgentUseCases,
  createGroupUseCases,
  createPolicyBindings,
} from './modules/agents/index.ts';
import { auditLog, createAudit } from './modules/audit/index.ts';
import {
  authorizer,
  bootstrapLocalOrg,
  getOrganization,
  orgSettings,
  orgUseCases,
  principalRegistry,
} from './modules/org/index.ts';
import { createRuns } from './modules/runs/index.ts';
import { createTasks } from './modules/tasks/index.ts';
import { createUsage } from './modules/usage/index.ts';

export type ResolveActor = (request: FastifyRequest) => ActorContext | Promise<ActorContext>;

export interface CompositionOptions {
  database: Database;
  /** AGENT_BAND_HOME, used for the secret key file. */
  home: string;
  secretKey?: SecretKeySource;
  /** Replaces the local-user resolver; tests inject other actors here. */
  resolveActor?: (request: FastifyRequest, local: ActorContext) => ActorContext | Promise<ActorContext>;
}

/** All use cases wired to real port implementations. Routes and roles depend only on this. */
export async function createComposition(opts: CompositionOptions) {
  const { database } = opts;
  const boot = await bootstrapLocalOrg(database.db);

  const secretKey = opts.secretKey ?? envOrFileKeySource({ home: opts.home });
  const deps: ModuleDeps = { authorizer, audit: auditLog };
  const settings: OrgSettings = orgSettings;

  const accounts = createAccountUseCases({ ...deps, secretKey, accountHasAgents });
  const agents = createAgentUseCases({
    ...deps,
    principals: principalRegistry,
    accountExists: accounts.accountExists,
  });
  const groups = createGroupUseCases(deps);
  const agentMembership: AgentMembership = createAgentMembership();
  const policyBindings: PolicyBindings = createPolicyBindings({
    orgPolicyId: async (db, orgId) => (await getOrganization(db, orgId)).policyId,
  });
  const tasks = createTasks({ ...deps, orgSettings: settings });
  const runs = createRuns(deps);
  const usage = createUsage({
    ...deps,
    orgSettings: settings,
    usageOnDay: (db, actor, scope, tz, now) => runs.usageOnDay(db, actor, scope, tz, now),
    runningCount: (db, actor, accountId) => runs.runningCount(db, actor, accountId),
  });
  const audit = createAudit(authorizer);
  const events = new EventStream(database);

  // T7 (policy, skills): build the policy and skills use cases here, with `policyBindings`,
  // `agentMembership` and the authorizer, and expose them on the returned object.

  const resolveActor: ResolveActor = (request) => {
    const local: ActorContext = { ...boot.localUser, requestId: request.id };
    return opts.resolveActor ? opts.resolveActor(request, local) : local;
  };

  return {
    database,
    events,
    orgId: boot.orgId,
    localUser: boot.localUser,
    dispatcher: boot.dispatcher,
    resolveActor,
    /** Latest outbox id at read time; every list endpoint returns it as `cursor`. */
    cursor: () => latestOutboxId(database.db),
    ports: {
      authorizer,
      audit: auditLog,
      principalRegistry,
      orgSettings: settings,
      agentMembership,
      policyBindings,
    },
    listProviders,
    org: orgUseCases,
    accounts,
    agents,
    groups,
    tasks,
    runs,
    usage,
    audit,
  };
}

export type Composition = Awaited<ReturnType<typeof createComposition>>;
