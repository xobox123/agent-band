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
  capabilities: ProviderCapabilities,
});
export type ProviderDto = z.infer<typeof ProviderDto>;
export const ProviderList = z.object({ items: z.array(ProviderDto) });

export const AccountLimits = z
  .object({
    dailyTokenBudget: z.number().int().positive().optional(),
    maxConcurrentRuns: z.number().int().positive().default(1),
  })
  .strict();

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
    maxConcurrentRuns: z.number(),
  }),
  providerIdentity: z.string().nullable(),
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
