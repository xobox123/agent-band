import { z } from 'zod';
import { AccountDto } from './accounts.ts';
import { AgentDto } from './agents.ts';
import { Id, IsoDate } from './common.ts';
import { RunDto } from './runs.ts';

export const LimitWindowDto = z.object({
  window: z.enum(['5h', 'weekly']),
  usedPercent: z.number(),
  resetsAt: IsoDate.nullable(),
});
export type LimitWindowDto = z.infer<typeof LimitWindowDto>;

export const DashboardAccount = z.object({
  account: AccountDto,
  windows: z.array(LimitWindowDto),
  tokensToday: z.number(),
  /** Cache reads, reported separately; not counted in budgets. */
  cachedTokensToday: z.number(),
  runningRuns: z.number().int(),
  /** Set while the account is blocked by a rate limit. */
  blockedUntil: IsoDate.nullable(),
});

export const AgentStatus = z.enum(['running', 'idle', 'blocked', 'disabled']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const DashboardAgent = z.object({
  agent: AgentDto,
  status: AgentStatus,
  runningRunId: Id.nullable(),
  tokensToday: z.number(),
});

export const DashboardDto = z.object({
  cursor: z.number().int().nonnegative(),
  accounts: z.array(DashboardAccount),
  agents: z.array(DashboardAgent),
  runningRuns: z.array(RunDto),
  queuedCount: z.number().int(),
  tokensToday: z.number(),
  cachedTokensToday: z.number(),
});
export type DashboardDto = z.infer<typeof DashboardDto>;
