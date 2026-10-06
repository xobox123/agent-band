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
  setOrgPolicy,
  orgSettings,
  orgUseCases,
  principalRegistry,
} from './modules/org/index.ts';
import {
  createPolicy,
  getEffectivePolicy,
  getPolicy,
  listPolicies,
  policyExists,
  updatePolicy,
} from './modules/policy/index.ts';
import {
  assignSkill,
  getEffectiveSkills,
  getSkill,
  importSkill,
  listSkillAssignments,
  listSkills,
  newSkillVersion,
  unassignSkill,
} from './modules/skills/index.ts';
import { createRuns } from './modules/runs/index.ts';
import { createTasks } from './modules/tasks/index.ts';
import { createUsage } from './modules/usage/index.ts';

const BASELINE_POLICY_NAME = 'Default';

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
  const db = database.db;
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
    usageOnDay: (db, actor, scope, tz, now, kind) => runs.usageOnDay(db, actor, scope, tz, now, kind),
    runningCount: (db, actor, accountId) => runs.runningCount(db, actor, accountId),
  });
  const audit = createAudit(authorizer);
  const events = new EventStream(database);

  const policies = {
    create: (actor: ActorContext, input: Parameters<typeof createPolicy>[3]) =>
      createPolicy(db, deps, actor, input),
    update: (actor: ActorContext, id: string, input: Parameters<typeof updatePolicy>[4]) =>
      updatePolicy(db, deps, actor, id, input),
    get: (actor: ActorContext, id: string) => getPolicy(db, deps, actor, id),
    list: (actor: ActorContext) => listPolicies(db, deps, actor),
    exists: (orgId: string, id: string) => policyExists(db, orgId, id),
    effectiveFor: (orgId: string, agentId: string) =>
      getEffectivePolicy(db, agentId, { orgId, bindings: policyBindings }),
  };
  const skills = {
    import: (actor: ActorContext, input: Parameters<typeof importSkill>[3]) =>
      importSkill(db, deps, actor, input),
    newVersion: (actor: ActorContext, id: string, input: Parameters<typeof newSkillVersion>[4]) =>
      newSkillVersion(db, deps, actor, id, input),
    get: (actor: ActorContext, id: string) => getSkill(db, deps, actor, id),
    list: (actor: ActorContext) => listSkills(db, deps, actor),
    assign: (actor: ActorContext, input: Parameters<typeof assignSkill>[3]) =>
      assignSkill(db, deps, actor, input),
    unassign: (actor: ActorContext, id: string) => unassignSkill(db, deps, actor, id),
    listAssignments: (actor: ActorContext, filter?: { skillId?: string }) =>
      listSkillAssignments(db, deps, actor, filter),
    effectiveFor: (orgId: string, agentId: string) =>
      getEffectiveSkills(db, agentId, { orgId, membership: agentMembership }),
  };

  // Secure default: the org gets a baseline policy capping the mode at "edit" (once, audited).
  const org = await getOrganization(db, boot.orgId);
  if (org.policyId === null) {
    const existing = await policies.list(boot.dispatcher);
    if (!existing.some((p) => p.name === BASELINE_POLICY_NAME)) {
      const baseline = await policies.create(boot.dispatcher, {
        name: BASELINE_POLICY_NAME,
        description: 'Organization baseline',
        rules: { maxMode: 'edit' },
      });
      await setOrgPolicy(db, boot.dispatcher, { policyId: baseline.id });
    }
  }

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
    deps,
    policies,
    skills,
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
