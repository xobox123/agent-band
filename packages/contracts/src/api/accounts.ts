import { z } from 'zod';
import { Id, IsoDate, Labels, listOf } from './common.ts';

export const ProviderId = z.enum(['claude', 'openai', 'gemini', 'openai_compatible']);
export type ProviderId = z.infer<typeof ProviderId>;
export const PROVIDER_IDS = ProviderId.options;

export const AccountType = z.enum(['cli', 'api']);
export type AccountType = z.infer<typeof AccountType>;

export const ProviderCapabilities = z.object({
  runtimeToolEnforcement: z.boolean(),
  limitWindows: z.array(z.enum(['5h', 'weekly'])),
  costReporting: z.boolean(),
  skills: z.boolean(),
  systemPrompt: z.boolean(),
});

export const ProviderDto = z.object({
  id: ProviderId,
  displayName: z.string(),
  harness: z.enum(['claude-cli', 'codex-cli', 'gemini-cli']),
  accountTypes: z.array(AccountType),
  /** JSON Schema of the provider-specific account fields. */
  accountFields: z.unknown(),
  secretField: z.string().nullable(),
  adapterEnabled: z.boolean(),
  /** Account types the adapter can run today; a subset of `accountTypes`. */
  runnableTypes: z.array(AccountType),
  capabilities: ProviderCapabilities,
});
export type ProviderDto = z.infer<typeof ProviderDto>;
export const ProviderList = z.object({ items: z.array(ProviderDto) });

export const StopAt = z
  .object({
    fiveHourPercent: z.number().int().min(1).max(100).optional(),
    weeklyPercent: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const AccountLimits = z
  .object({
    dailyTokenBudget: z.number().int().positive().optional(),
    dailyCostBudgetUsd: z.number().positive().optional(),
    maxConcurrentRuns: z.number().int().positive().default(1),
    stopAt: StopAt.optional(),
  })
  .strict();

/** Provider-specific extras read together with the limit windows. */
export const UsageDetails = z.object({
  perModel: z
    .array(z.object({ label: z.string(), usedPercent: z.number(), resetsAt: IsoDate.nullable() }))
    .default([]),
  credits: z
    .object({ hasCredits: z.boolean(), unlimited: z.boolean(), balance: z.string().nullable() })
    .nullable()
    .default(null),
  ordinaryUsageAllowed: z.boolean().nullable().default(null),
  limitReached: z.boolean().default(false),
  daily: z.array(z.object({ date: z.string(), tokens: z.number() })).default([]),
});
export type UsageDetails = z.infer<typeof UsageDetails>;

export const AccountConnection = z.object({
  loggedIn: z.boolean(),
  plan: z.string().nullable(),
  email: z.string().nullable(),
  orgName: z.string().nullable().default(null),
  authMethod: z.string().nullable().default(null),
  checkedAt: IsoDate,
  usageDetails: UsageDetails.nullable().default(null),
});
export type AccountConnection = z.infer<typeof AccountConnection>;

/** Never carries the secret, only whether one is stored. */
export const AccountDto = z.object({
  id: Id,
  orgId: Id,
  name: z.string(),
  provider: ProviderId,
  type: AccountType,
  providerConfig: z.record(z.string(), z.unknown()),
  configDir: z.string().nullable(),
  labels: z.array(z.string()),
  limits: z.object({
    dailyTokenBudget: z.number().optional(),
    dailyCostBudgetUsd: z.number().optional(),
    maxConcurrentRuns: z.number(),
    stopAt: StopAt.optional(),
  }),
  providerIdentity: z.string().nullable(),
  connection: AccountConnection.nullable(),
  paused: z.boolean(),
  hasSecret: z.boolean(),
  secretUpdatedAt: IsoDate.nullable(),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type AccountDto = z.infer<typeof AccountDto>;
export const AccountList = listOf(AccountDto);

const configDir = z.string().min(1).max(4096);
const secret = z.string().min(1).max(8192);

export const CreateAccountBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    provider: ProviderId,
    type: AccountType,
    providerConfig: z.record(z.string(), z.unknown()).default({}),
    configDir: configDir.optional(),
    /** The server creates a private login directory for this account; excludes `configDir`. */
    managedConfigDir: z.boolean().optional(),
    /** Write-only. */
    secret: secret.optional(),
    labels: Labels.default([]),
    limits: AccountLimits.default({ maxConcurrentRuns: 1 }),
  })
  .strict();
export type CreateAccountBody = z.input<typeof CreateAccountBody>;

export const UpdateAccountBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    providerConfig: z.record(z.string(), z.unknown()).optional(),
    configDir: configDir.nullable().optional(),
    secret: secret.optional(),
    labels: Labels.optional(),
    limits: AccountLimits.optional(),
  })
  .strict();
export type UpdateAccountBody = z.input<typeof UpdateAccountBody>;

export const AccountQuery = z.object({
  provider: ProviderId.optional(),
  type: AccountType.optional(),
  label: z.string().optional(),
});

export const SetProviderIdentityBody = z
  .object({ providerIdentity: z.string().trim().min(1).max(320).nullable() })
  .strict();

export const ProbeIdentity = z.object({
  email: z.string().optional(),
  orgId: z.string().optional(),
  orgName: z.string().optional(),
  plan: z.string().optional(),
  authMethod: z.string().optional(),
});
export const ProbeResult = z.object({
  loggedIn: z.boolean(),
  identity: ProbeIdentity,
  checkedAt: IsoDate,
  error: z.string().optional(),
  note: z.string().optional(),
  /** Shown when not logged in: the exact command the user runs in a terminal. */
  loginCommand: z.string().nullable(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;

export const ProbeConfigBody = z
  .object({
    provider: ProviderId,
    type: AccountType,
    configDir: configDir.optional(),
    /** Write-only, api accounts: the key to test before saving. */
    secret: secret.optional(),
  })
  .strict();
export type ProbeConfigBody = z.input<typeof ProbeConfigBody>;

/** `console` logs in to the Anthropic Console (API billing) instead of a subscription. */
export const LoginBody = z.object({ mode: z.enum(['console']).optional() }).strict();

export const LoginResult = z.object({
  started: z.boolean(),
  /** The provider's own login command, to copy when spawning fails or is not wanted. */
  command: z.string(),
  /** Set when the provider gave a browser URL; it was also opened on this machine. */
  authUrl: z.string().optional(),
  error: z.string().optional(),
});
export type LoginResult = z.infer<typeof LoginResult>;

export const RefreshLimitsBody = z.object({}).strict();
export type RefreshLimitsBody = z.input<typeof RefreshLimitsBody>;

export const RefreshLimitsResult = z.object({
  windows: z.array(
    z.object({
      window: z.enum(['5h', 'weekly']),
      usedPercent: z.number(),
      resetsAt: IsoDate.nullable(),
    }),
  ),
  /** When the windows were read; null when nothing has been read yet. */
  updatedAt: IsoDate.nullable(),
  /** Set when the read failed and the last known windows are shown instead. */
  error: z.string().nullable(),
  details: UsageDetails.nullable(),
});
export type RefreshLimitsResult = z.infer<typeof RefreshLimitsResult>;

export const ModelOption = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),
  source: z.enum(['native', 'builtin']),
  /** Aliases and the account default; the entries most people want. */
  recommended: z.boolean().optional(),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const ModelList = z.object({
  items: z.array(ModelOption),
  fetchedAt: IsoDate,
  /** Set when the list is a fallback, for example the provider could not be reached. */
  note: z.string().optional(),
});
export type ModelList = z.infer<typeof ModelList>;
