import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { NormalizedEvent, ProviderAdapter, RunHandle, RunSpec } from '@agent-band/contracts';
import type { ActorContext } from '../platform/actor.ts';
import type { Db } from '../platform/db.ts';
import { AppError } from '../platform/errors.ts';
import type { EventStream } from '../platform/outbox.ts';
import type { Tx } from '../platform/tx.ts';
import type { AuditLog, EffectivePolicySource, EffectiveSkillsSource } from '../ports/index.ts';
import { getProvider, type AccountForRun } from '../modules/accounts/index.ts';
import type { AgentDto } from '../modules/agents/index.ts';
import type { createAgentUseCases } from '../modules/agents/index.ts';
import type { createRuns, Run } from '../modules/runs/index.ts';
import type { createTasks, Task } from '../modules/tasks/index.ts';
import type { createUsage } from '../modules/usage/index.ts';
import { evaluateRunStart, type EffectivePolicy } from '../modules/policy/index.ts';
import {
  newRunToken,
  registerRunAuth,
  removeRunDir,
  revokeRunAuth,
  stableHash,
  writeClaudePlugin,
} from '../execution/index.ts';

type Availability = Awaited<ReturnType<ReturnType<typeof createUsage>['accountAvailability']>>;

export interface WorkerDeps {
  db: Db;
  /** System actor (system:dispatcher) of the organisation this worker serves. */
  dispatcher: ActorContext;
  workerId: string;
  slots: number;
  apiPort: number;
  events: EventStream;
  audit: AuditLog;
  tasks: ReturnType<typeof createTasks>;
  runs: ReturnType<typeof createRuns>;
  usage: ReturnType<typeof createUsage>;
  agents: Pick<ReturnType<typeof createAgentUseCases>, 'getAgent' | 'listAgents'>;
  accounts: { getAccountForRun(db: Db, orgId: string, id: string): Promise<AccountForRun> };
  policy: EffectivePolicySource;
  skills: EffectiveSkillsSource;
  adapterFor(account: AccountForRun): ProviderAdapter | undefined;
  pollIntervalMs?: number;
  /** How long a released task is skipped by this worker before it is claimed again. */
  retryDelayMs?: number;
  /** Length of one policy minute in ms (tests shorten it). */
  minuteMs?: number;
  runsRoot?: string;
  /** Random delay added to an automatic resume time (default 0 to 60 s). */
  resumeJitterMs?: () => number;
  log?: (level: 'warn' | 'error', message: string, err?: unknown) => void;
}

export interface Worker {
  start(): Promise<void>;
  /** Stops claiming; waits for active runs, or cancels them when `force` is set. */
  stop(opts?: { force?: boolean }): Promise<void>;
  readonly activeRuns: number;
}

interface Candidate {
  agent: AgentDto;
  account: AccountForRun;
  policy: EffectivePolicy;
  policyHash: string;
  skills: Awaited<ReturnType<EffectiveSkillsSource['forAgent']>>;
  skillsLoadable: boolean;
  mode: RunSpec['mode'];
}

interface InFlight {
  cancel?: () => void;
  userCancelled: boolean;
}

const isConflict = (err: unknown): boolean => err instanceof AppError && err.status === 409;

function describeUnavailable(a: Extract<Availability, { ok: false }>, accountId: string): string {
  switch (a.reason) {
    case 'rate_limited':
      return `account ${accountId} is rate limited${a.resetsAt ? ` until ${a.resetsAt.toISOString()}` : ''}`;
    case 'concurrency':
      return `account ${accountId} is at its concurrent run limit`;
    case 'daily_budget':
      return `account ${accountId} exhausted its daily token budget`;
  }
}

export function createWorker(deps: WorkerDeps): Worker {
  const d = deps.dispatcher;
  const orgId = d.orgId;
  const pollMs = deps.pollIntervalMs ?? 1000;
  const retryMs = deps.retryDelayMs ?? 5000;
  const minuteMs = deps.minuteMs ?? 60_000;
  const runsRoot = deps.runsRoot ?? join(tmpdir(), 'agent-band', 'runs');
  const log = deps.log ?? (() => undefined);

  const active = new Set<Promise<void>>();
  const inFlight = new Map<string, InFlight>();
  const backoff = new Map<string, number>();
  let stopping = false;
  let forceStop = false;
  let loopDone: Promise<void> = Promise.resolve();
  let unsubscribe: (() => void) | undefined;
  let wakers: (() => void)[] = [];

  const wake = () => {
    const w = wakers;
    wakers = [];
    for (const fn of w) fn();
  };
  const waitSignal = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      wakers.push(done);
    });

  async function audit(tx: Tx, action: string, targetType: string, targetId: string, data: unknown) {
    await deps.audit.append(tx, { orgId, actorId: d.principalId, action, targetType, targetId, data });
  }

  async function resolveCandidates(task: Task): Promise<AgentDto[]> {
    const target = task.target;
    if ('agentId' in target) {
      try {
        return [await deps.agents.getAgent(deps.db, d, target.agentId)];
      } catch (err) {
        if (err instanceof AppError && err.status === 404) return [];
        throw err;
      }
    }
    if ('label' in target) return deps.agents.listAgents(deps.db, d, { label: target.label });
    return deps.agents.listAgents(deps.db, d, { groupId: target.agentGroupId });
  }

  async function evaluate(task: Task, agent: AgentDto): Promise<{ c?: Candidate; reasons: string[] }> {
    let account: AccountForRun;
    try {
      account = await deps.accounts.getAccountForRun(deps.db, orgId, agent.accountId);
    } catch {
      return { reasons: [`agent ${agent.handle}: account not found`] };
    }
    const provider = getProvider(account.provider);
    const skillsLoadable = provider?.harness === 'claude-cli' && account.type === 'cli';
    const policy = await deps.policy.forAgent(deps.db, orgId, agent.id);
    const skills = skillsLoadable ? await deps.skills.forAgent(deps.db, orgId, agent.id) : [];
    const agentTokensToday = await deps.usage.tokensToday(deps.db, d, { agentId: agent.id });
    const decision = evaluateRunStart(policy, {
      agentEnabled: agent.enabled,
      workDir: task.workDir,
      ...(task.mode ? { requestedMode: task.mode } : {}),
      accountId: account.id,
      skillIds: skills.map((s) => s.skillId),
      agentTokensToday,
    });
    const policyHash = stableHash(policy);
    await deps.db.transaction((tx) =>
      audit(tx, 'policy.decision', 'task', task.id, {
        agentId: agent.id,
        allow: decision.allow,
        reasons: decision.reasons,
        mode: decision.mode,
        effectivePolicyHash: policyHash,
      }),
    );
    if (!decision.allow) return { reasons: decision.reasons.map((r) => `agent ${agent.handle}: ${r}`) };
    return {
      c: { agent, account, policy, policyHash, skills, skillsLoadable, mode: decision.mode },
      reasons: [],
    };
  }

  /** Checks account availability and starts the run in one transaction, serialised per account. */
  async function tryStart(
    task: Task,
    c: Candidate,
    token: string,
  ): Promise<{ run: Run } | { unavailable: Extract<Availability, { ok: false }> } | { abandoned: true }> {
    try {
      return await deps.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'account-start:' + c.account.id}))`);
        const availability = await deps.usage.accountAvailability(tx, d, c.account.id, c.account.limits);
        if (!availability.ok) return { unavailable: availability };
        const run = await deps.runs.startRun(tx, d, {
          taskId: task.id,
          agentId: c.agent.id,
          accountId: c.account.id,
          workerId: deps.workerId,
          effectivePolicy: {
            ...c.policy,
            hash: c.policyHash,
            mode: c.mode,
            ...(!c.skillsLoadable ? { skillsNote: 'skills not supported for provider' } : {}),
          },
          skills: c.skills.map(({ skillId, version, contentHash }) => ({ skillId, version, contentHash })),
        });
        await deps.tasks.setTaskStatus(tx, d, task.id, 'running');
        if (c.skillsLoadable) {
          await registerRunAuth(tx, {
            runId: run.id,
            orgId,
            agentId: c.agent.id,
            workDir: task.workDir,
            token,
            policy: {
              ...(c.policy.allowedTools ? { allowedTools: c.policy.allowedTools } : {}),
              deniedTools: c.policy.deniedTools,
              workDirSets: c.policy.workDirSets,
            },
          });
        }
        return { run };
      });
    } catch (err) {
      // The task was cancelled while it was claimed.
      if (isConflict(err)) return { abandoned: true };
      throw err;
    }
  }

  async function dispatch(task: Task): Promise<void> {
    const candidates = await resolveCandidates(task);
    const denials: string[] = [];
    let blocked: { c: Candidate; text: string } | undefined;
    const token = newRunToken();

    if (candidates.length === 0) {
      if ('agentId' in task.target) {
        await deps.db.transaction((tx) =>
          deps.tasks.setTaskStatus(tx, d, task.id, 'denied', 'target agent not found'),
        );
      } else await release(task, 'no matching agent');
      return;
    }
    for (const agent of candidates) {
      // Without explicit failover the first unavailable account ends the search.
      if (blocked && !blocked.c.policy.allowAccountFailover) break;
      const { c, reasons } = await evaluate(task, agent);
      if (!c) {
        denials.push(...reasons);
        continue;
      }
      if (blocked) {
        if (c.account.id === blocked.c.account.id || !c.policy.allowAccountFailover) continue;
        await deps.db.transaction((tx) =>
          audit(tx, 'task.failover', 'task', task.id, {
            fromAgentId: blocked?.c.agent.id,
            toAgentId: c.agent.id,
            fromAccountId: blocked?.c.account.id,
            toAccountId: c.account.id,
            reason: blocked?.text,
          }),
        );
      }
      const started = await tryStart(task, c, token);
      if ('abandoned' in started) return;
      if ('run' in started) {
        await execute(task, c, started.run, token);
        return;
      }
      blocked ??= { c, text: describeUnavailable(started.unavailable, c.account.id) };
    }
    if (blocked) {
      await release(task, blocked.text);
      return;
    }
    await deps.db.transaction((tx) =>
      deps.tasks.setTaskStatus(tx, d, task.id, 'denied', denials.join('; ') || 'denied by policy'),
    );
  }

  async function release(task: Task, reason: string): Promise<void> {
    backoff.set(task.id, Date.now() + retryMs);
    try {
      await deps.db.transaction((tx) =>
        deps.tasks.releaseTask(tx, d, task.id, `no eligible agent: ${reason}`),
      );
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  }

  async function execute(task: Task, c: Candidate, run: Run, token: string): Promise<void> {
    const entry = inFlight.get(task.id) ?? { userCancelled: false };
    const dir = join(runsRoot, run.id);
    let timedOut = false as boolean;
    let lastError: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let handle: RunHandle | undefined;
    let failure: string | undefined;
    try {
      const adapter = deps.adapterFor(c.account);
      if (!adapter) throw new Error(`no adapter for provider ${c.account.provider}`);
      if (c.skillsLoadable) {
        const skills = [];
        for (const s of c.skills) {
          skills.push({
            skillId: s.skillId,
            name: s.name,
            files: await deps.skills.loadBundle(deps.db, orgId, s.skillId, s.version),
          });
        }
        await writeClaudePlugin({ dir, runId: run.id, skills, hook: { port: deps.apiPort } });
      } else if (c.account.type === 'cli') {
        // Codex has no safe per-run skill loading (see docs/research/cli-capability-matrix.md).
        await append(run.id, {
          kind: 'stderr',
          text: `skills not supported for provider ${c.account.provider}`,
        });
      }
      const spec: RunSpec = {
        runId: run.id,
        prompt: task.prompt,
        workDir: task.workDir,
        mode: c.mode,
        ...(c.agent.model ? { model: c.agent.model } : {}),
        ...(systemPromptOf(c.agent) ? { systemPrompt: systemPromptOf(c.agent) } : {}),
        ...(c.policy.allowedTools ? { allowedTools: c.policy.allowedTools } : {}),
        ...(c.policy.deniedTools.length ? { deniedTools: c.policy.deniedTools } : {}),
        configDir:
          c.account.configDir ?? join(homedir(), c.account.provider === 'openai' ? '.codex' : '.claude'),
        ...(c.skillsLoadable ? { skillsDir: dir } : {}),
        gitIdentity: c.agent.gitIdentity,
        agentId: c.agent.id,
        env: { AGENT_BAND_RUN_TOKEN: token },
      };
      handle = adapter.start(spec);
      const h = handle;
      entry.cancel = () => {
        h.cancel();
      };
      if (entry.userCancelled || forceStop) h.cancel();
      if (c.policy.maxRunMinutes !== undefined) {
        timer = setTimeout(() => {
          timedOut = true;
          h.cancel();
        }, c.policy.maxRunMinutes * minuteMs);
      }
      for await (const event of h.events) {
        if (event.kind === 'error') lastError = event.message;
        await append(run.id, event);
        if (event.kind === 'rate_limit') await recordLimits(c.account.id, event);
      }
      const result = await h.done;
      failure =
        result.error ??
        (result.exitCode !== 0 && !entry.userCancelled ? `exit code ${result.exitCode}` : undefined);
      if (result.exitCode === 0 && !result.error) failure = undefined;
      await finish(task, run, {
        status:
          timedOut || forceStop ? 'failed' : entry.userCancelled ? 'cancelled' : failure ? 'failed' : 'done',
        exitCode: result.exitCode,
        error: timedOut
          ? `maxRunMinutes (${c.policy.maxRunMinutes}) exceeded`
          : forceStop
            ? 'Worker stopped'
            : failure
              ? (lastError ?? failure)
              : undefined,
        userCancelled: entry.userCancelled,
      });
    } catch (err) {
      log('error', `run ${run.id} failed`, err);
      handle?.cancel();
      await finish(task, run, {
        status: 'failed',
        exitCode: null,
        error: err instanceof Error ? err.message : String(err),
        userCancelled: false,
      }).catch((e: unknown) => {
        log('error', `could not finish run ${run.id}`, e);
      });
    } finally {
      clearTimeout(timer);
      await removeRunDir(dir).catch(() => undefined);
    }
  }

  const systemPromptOf = (agent: AgentDto): string | undefined =>
    [agent.persona, agent.systemPrompt].filter(Boolean).join('\n\n') || undefined;

  async function append(runId: string, event: NormalizedEvent): Promise<void> {
    try {
      await deps.db.transaction((tx) => deps.runs.appendRunEvent(tx, d, runId, event));
    } catch (err) {
      log('warn', `could not record event for run ${runId}`, err);
    }
  }

  async function recordLimits(
    accountId: string,
    event: Extract<NormalizedEvent, { kind: 'rate_limit' }>,
  ): Promise<void> {
    try {
      await deps.db.transaction(async (tx) => {
        if (event.windows.length > 0) await deps.usage.recordWindows(tx, d, accountId, event.windows);
        if (event.limitReached) {
          // Without a reset time, block for an hour so the account is not hammered.
          const until = event.resetsAt ? new Date(event.resetsAt) : new Date(Date.now() + 3_600_000);
          await deps.usage.blockAccount(tx, d, accountId, until);
        }
      });
    } catch (err) {
      log('warn', `could not record limits for account ${accountId}`, err);
    }
  }

  async function finish(
    task: Task,
    run: Run,
    r: {
      status: 'done' | 'failed' | 'cancelled';
      exitCode: number | null;
      error: string | undefined;
      userCancelled: boolean;
    },
  ): Promise<void> {
    // The account block recorded from the run's rate-limit events decides when the task may resume.
    const blockedUntil = await deps.usage.accountBlock(deps.db, d, run.accountId).catch(() => null);
    await deps.db.transaction(async (tx) => {
      const finished = await deps.runs.finishRun(tx, d, run.id, {
        status: r.status,
        exitCode: r.exitCode,
        ...(r.error ? { error: r.error } : {}),
      });
      await revokeRunAuth(tx, run.id);
      const taskStatus =
        finished.status === 'done'
          ? 'done'
          : finished.status === 'rate_limited'
            ? 'rate_limited'
            : finished.status === 'failed'
              ? 'failed'
              : undefined;
      if (!taskStatus) return;
      try {
        await deps.tasks.setTaskStatus(
          tx,
          d,
          task.id,
          taskStatus,
          taskStatus === 'rate_limited'
            ? `rate limited${finished.rateLimitResetsAt ? ` until ${finished.rateLimitResetsAt.toISOString()}` : ''}`
            : r.error,
          taskStatus === 'rate_limited'
            ? {
                resumeAt: new Date(
                  (blockedUntil ?? finished.rateLimitResetsAt ?? new Date(Date.now() + 3_600_000)).getTime() +
                    (deps.resumeJitterMs?.() ?? Math.random() * 60_000),
                ),
              }
            : {},
        );
      } catch (err) {
        // The task was cancelled by a user while the run was ending.
        if (!isConflict(err)) throw err;
      }
    });
  }

  async function process(task: Task): Promise<void> {
    inFlight.set(task.id, { userCancelled: false });
    try {
      await dispatch(task);
    } catch (err) {
      log('error', `task ${task.key} failed to dispatch`, err);
      await deps.db
        .transaction((tx) =>
          deps.tasks.setTaskStatus(
            tx,
            d,
            task.id,
            'failed',
            err instanceof Error ? err.message : String(err),
          ),
        )
        .catch((e: unknown) => {
          log('error', `could not fail task ${task.key}`, e);
        });
    } finally {
      inFlight.delete(task.id);
    }
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      if (active.size >= deps.slots) {
        await waitSignal(pollMs);
        continue;
      }
      const now = Date.now();
      for (const [id, until] of backoff) if (until <= now) backoff.delete(id);
      let task: Task | null = null;
      try {
        task = await deps.db.transaction((tx) =>
          deps.tasks.claimNextTask(tx, d, deps.workerId, { excludeTaskIds: [...backoff.keys()] }),
        );
      } catch (err) {
        log('error', 'claim failed', err);
      }
      if (!task) {
        await waitSignal(pollMs);
        continue;
      }
      const p: Promise<void> = process(task).finally(() => {
        active.delete(p);
        wake();
      });
      active.add(p);
    }
  }

  return {
    get activeRuns() {
      return active.size;
    },
    async start() {
      stopping = false;
      forceStop = false;
      const stale = await deps.runs.recoverStaleRuns(deps.db, d, deps.workerId);
      for (const run of stale) {
        await deps.db.transaction(async (tx) => {
          await revokeRunAuth(tx, run.id);
          try {
            await deps.tasks.setTaskStatus(tx, d, run.taskId, 'failed', 'Worker stopped before run finished');
          } catch (err) {
            if (!isConflict(err)) throw err;
          }
        });
      }
      unsubscribe = deps.events.subscribe((event) => {
        const payload = event.payload as { orgId?: string; taskId?: string };
        if (payload.orgId !== orgId) return;
        if (event.type === 'task.cancel_requested' && payload.taskId) {
          const entry = inFlight.get(payload.taskId);
          if (entry) {
            entry.userCancelled = true;
            entry.cancel?.();
          }
        } else if (event.type === 'task.updated') wake();
      });
      await deps.events.start();
      loopDone = loop();
    },
    async stop(opts = {}) {
      stopping = true;
      if (opts.force) {
        forceStop = true;
        for (const entry of inFlight.values()) entry.cancel?.();
      }
      wake();
      await loopDone;
      await Promise.all([...active]);
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
